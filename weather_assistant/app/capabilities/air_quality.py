"""Capability de calidad del aire: sus tools las sirve un servidor MCP, no funciones locales.

Es el caso que MemTrace detecta como servidor MCP (ADR-056): el toolset lleva un `id`, y el SDK lo
anota en el span de cada tool que sirve.
"""

import sys

from pydantic_ai.mcp import MCPToolset

from app.capabilities.base import Capability

MCP_SERVER_ID = "air-quality-mcp"


def air_quality_capability(url: str | None = None) -> Capability:
    """`url`: servidor MCP por HTTP; sin ella, arranca el servidor del repo por stdio."""
    if url:
        toolset = MCPToolset(url, id=MCP_SERVER_ID)
    else:
        toolset = MCPToolset(
            {"mcpServers": {MCP_SERVER_ID: {"command": sys.executable, "args": ["-m", "app.mcp_servers.air_quality"]}}},
            id=MCP_SERVER_ID,
        )
    return Capability(
        name="air_quality",
        description="Calidad del aire por localidad (servidor MCP)",
        instructions=(
            "Para preguntas sobre la calidad del aire o la contaminación, llama a `get_air_quality` "
            "con la localidad que mencione el usuario. Si la tool devuelve un error, díselo sin inventar datos."
        ),
        toolsets=[toolset],
    )
