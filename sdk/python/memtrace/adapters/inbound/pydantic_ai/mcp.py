"""Names the MCP server on the tool spans Pydantic AI emits (ADR-053 §8).

Pydantic AI's tool span only carries `gen_ai.tool.name`, so a tool served by an MCP toolset looks
like a local function. The span is the *current* one while the toolset's `call_tool` runs, so
wrapping that method is enough to stamp `memtrace.mcp_server` on it.
"""
import functools
import logging
from typing import Any, Optional

from memtrace.dependency_container import get_service
from memtrace.domain import semconv as sc

logger = logging.getLogger("memtrace")

_PATCHED = "_memtrace_mcp_patched"
_CLASS_NAMES = ("MCPServer", "MCPToolset")  # <= 1.x and >= 2.x


def mcp_server_name(toolset: Any) -> Optional[str]:
    """The name the user gave the toolset (`id`), else the one the server announced; None if neither is known."""
    for read in (lambda: toolset.id, lambda: toolset.server_info.name):
        try:
            name = read()
        except Exception:  # `server_info` raises until the session is initialized
            continue
        if isinstance(name, str) and name:
            return name
    return None


def _wrap(original: Any) -> Any:
    @functools.wraps(original)
    async def call_tool(self: Any, *args: Any, **kwargs: Any) -> Any:
        name = mcp_server_name(self)
        if name:
            get_service().annotate_current({sc.MEMTRACE_MCP_SERVER: name})
        return await original(self, *args, **kwargs)

    setattr(call_tool, _PATCHED, True)
    return call_tool


def instrument_mcp_toolsets() -> None:
    """Wraps `call_tool` of Pydantic AI's MCP toolset classes, once. Does nothing if there are none."""
    try:
        from pydantic_ai import mcp
    except ImportError:  # the `mcp` extra of Pydantic AI is optional
        return
    for class_name in _CLASS_NAMES:
        cls = getattr(mcp, class_name, None)
        original = getattr(cls, "call_tool", None)
        if original is None or getattr(original, _PATCHED, False):
            continue
        cls.call_tool = _wrap(original)
        logger.info("[MemTrace] MCP tool spans will carry their server name (%s)", class_name)
