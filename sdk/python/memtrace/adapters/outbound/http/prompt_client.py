"""HTTP adapter of the prompt registry against MemTrace's own query API (ADR-068).

Optional: requires `pip install 'memtrace-ai[eval]'` (httpx), like the other HTTP adapters. The agent's API key is the
credential and `base_url` is the one of its experiment (`.../api/v1/experiments/<id>`), as for feedback and evaluation.

Contract (JSON keys are camelCase):
    GET  {base_url}/prompts/resolve?name=&tag=   or   ?name=&version=
         -> 200 {"name", "version", "tag", "content", "variables", "contentHash", "archived"} + ETag
         -> 304 when `If-None-Match` carries the ETag of the version the caller already has
         -> 404 the prompt, tag or version does not exist for this agent
    GET  {base_url}/prompts/resolve?name=&override=<token>   (playground, ADR-071)
         -> 200 the version the token grants, 404 if MemTrace does not recognize the token for this prompt
    POST {base_url}/prompts/drafts  body {name, content, message?, basedOn?, origin?: {traceIds, cause, rationale}}  -> 201 (ADR-072)
    POST {base_url}/prompts/usage   body {"environment": str | null, "items": [{"name", "tag", "version"}]}  -> 200
"""
import threading
from typing import Any, Dict, Optional, Sequence

from memtrace.application.prompt_ports import Fetched, PromptSourceError, UsedPrompt
from memtrace.domain.prompt import PromptNotFoundError, PromptVersion


class HttpPromptClient:
    """Implements `PromptSource` and `UsageSink`. Short timeouts: it must never hold an agent back."""

    def __init__(self, base_url: str, api_key: Optional[str], *, timeout: float = 3.0, transport: Optional[Any] = None) -> None:
        self._base_url = base_url
        self._api_key = api_key
        self._timeout = timeout
        self._transport = transport
        self._client: Any = None
        self._lock = threading.Lock()

    def _http(self) -> Any:
        if self._client is None:
            with self._lock:
                if self._client is None:
                    try:
                        import httpx
                    except ImportError as exc:
                        raise ImportError("Using the prompt registry requires: pip install 'memtrace-ai[eval]'") from exc
                    headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
                    self._client = httpx.Client(base_url=self._base_url, headers=headers, timeout=self._timeout, transport=self._transport)
        return self._client

    def fetch(self, name: str, tag: Optional[str], version: Optional[int], etag: Optional[str]) -> Optional[Fetched]:
        params: Dict[str, Any] = {"name": name}
        if tag is not None:
            params["tag"] = tag
        if version is not None:
            params["version"] = version
        headers = {"If-None-Match": etag} if etag else {}
        response = self._send("GET", "/prompts/resolve", params=params, headers=headers)
        if response.status_code == 304:
            return None
        if response.status_code == 404:
            raise PromptNotFoundError(_detail(response) or f"Prompt '{name}' not found for this agent")
        if response.status_code >= 400:
            raise PromptSourceError(f"MemTrace answered {response.status_code}: {_detail(response)}")
        body = response.json()
        return Fetched(
            PromptVersion(
                name=body["name"],
                version=int(body["version"]),
                content=body["content"],
                variables=tuple(body.get("variables") or ()),
                content_hash=body.get("contentHash", ""),
                archived=bool(body.get("archived", False)),
                draft=bool(body.get("draft", False)),
            ),
            response.headers.get("ETag"),
        )

    def fetch_override(self, name: str, token: str) -> Optional[PromptVersion]:
        response = self._send("GET", "/prompts/resolve", params={"name": name, "override": token})
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise PromptSourceError(f"MemTrace answered {response.status_code}: {_detail(response)}")
        body = response.json()
        return PromptVersion(
            name=body["name"],
            version=int(body["version"]),
            content=body["content"],
            variables=tuple(body.get("variables") or ()),
            content_hash=body.get("contentHash", ""),
            archived=bool(body.get("archived", False)),
        )

    def save_draft(
        self,
        name: str,
        content: str,
        *,
        message: str = "",
        based_on: Optional[int] = None,
        trace_ids: Sequence[str] = (),
        cause: Optional[str] = None,
        rationale: str = "",
    ) -> Dict[str, Any]:
        """Saves `content` as a DRAFT of prompt `name` (ADR-072). A tool can propose; only a person publishes."""
        body = {
            "name": name,
            "content": content,
            "message": message,
            "basedOn": based_on,
            "origin": {"traceIds": list(trace_ids), "cause": cause, "rationale": rationale},
        }
        response = self._send("POST", "/prompts/drafts", json=body)
        if response.status_code >= 400:
            raise PromptSourceError(f"MemTrace answered {response.status_code}: {_detail(response)}")
        return dict(response.json())

    def report(self, environment: Optional[str], items: Sequence[UsedPrompt]) -> None:
        body = {"environment": environment, "items": [{"name": i.name, "tag": i.tag, "version": i.version} for i in items]}
        response = self._send("POST", "/prompts/usage", json=body)
        if response.status_code >= 400:
            raise PromptSourceError(f"MemTrace answered {response.status_code}: {_detail(response)}")

    def _send(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            return self._http().request(method, path, **kwargs)
        except ImportError:
            raise
        except Exception as exc:  # httpx.HTTPError: timeouts, refused connections, TLS...
            raise PromptSourceError(f"{type(exc).__name__}: {exc}") from exc

    def close(self) -> None:
        if self._client is not None:
            self._client.close()


def _detail(response: Any) -> str:
    try:
        body = response.json()
        return str(body.get("detail") or body.get("title") or "")
    except Exception:
        return ""
