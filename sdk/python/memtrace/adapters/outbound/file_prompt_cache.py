"""Disk cache of the last known prompt versions (ADR-068): lets an agent start while MemTrace is unreachable."""
import json
import logging
import os
import tempfile
from typing import Optional

from memtrace.domain.prompt import PromptVersion

logger = logging.getLogger("memtrace")


class FilePromptCache:
    """One small JSON file per (prompt, tag or version). Every failure is swallowed: the cache is a convenience."""

    def __init__(self, directory: str) -> None:
        self._directory = directory

    def _path(self, name: str, tag: Optional[str], version: Optional[int]) -> str:
        # names and tags are slugs (the API enforces it), but never trust a value that ends up in a path
        safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in f"{name}__{tag or ''}__{version or ''}")
        return os.path.join(self._directory, f"{safe}.json")

    def load(self, name: str, tag: Optional[str], version: Optional[int]) -> Optional[PromptVersion]:
        try:
            with open(self._path(name, tag, version), encoding="utf-8") as handle:
                data = json.load(handle)
            return PromptVersion(
                name=data["name"],
                version=int(data["version"]),
                content=data["content"],
                variables=tuple(data.get("variables") or ()),
                content_hash=data.get("content_hash", ""),
                archived=bool(data.get("archived", False)),
            )
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def store(self, name: str, tag: Optional[str], version: Optional[int], value: PromptVersion) -> None:
        try:
            os.makedirs(self._directory, exist_ok=True)
            payload = {"name": value.name, "version": value.version, "content": value.content, "variables": list(value.variables), "content_hash": value.content_hash, "archived": value.archived}
            fd, tmp = tempfile.mkstemp(dir=self._directory, suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
            os.replace(tmp, self._path(name, tag, version))  # atomic: a reader never sees half a file
        except OSError as exc:
            logger.debug("[MemTrace] Could not write the prompt cache: %s", exc)
