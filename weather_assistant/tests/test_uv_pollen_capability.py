import httpx
import pytest
from pydantic_ai import models
from pydantic_ai.messages import ToolReturnPart
from pydantic_ai.models.test import TestModel

from app.agents.assistant import build_assistant
from app.agents.deps import AssistantDeps
from app.capabilities.registry import build_capabilities
from app.capabilities.uv_pollen import get_uv_and_pollen
from app.services.weather_service import WeatherService, describe_uv_index

models.ALLOW_MODEL_REQUESTS = False

GEOCODING = {"results": [{"name": "Sevilla", "country": "España", "latitude": 37.39, "longitude": -5.99}]}
AIR = {
    "current": {
        "time": "2026-10-06T12:00",
        "uv_index": 6.4,
        "alder_pollen": None,
        "birch_pollen": 0.0,
        "grass_pollen": 12.5,
        "mugwort_pollen": 3.0,
        "olive_pollen": 40.0,
        "ragweed_pollen": None,
    }
}


def make_service(geocoding: dict = GEOCODING) -> WeatherService:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=geocoding if "geocoding" in request.url.host else AIR)

    return WeatherService(
        httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        geocoding_url="https://geocoding-api.open-meteo.com/v1/search",
        forecast_url="https://api.open-meteo.com/v1/forecast",
        air_quality_url="https://air-quality-api.open-meteo.com/v1/air-quality",
    )


class Ctx:
    def __init__(self, service: WeatherService) -> None:
        self.deps = AssistantDeps(weather=service)


async def test_tool_returns_uv_and_pollen_without_missing_types():
    result = await get_uv_and_pollen(Ctx(make_service()), location="Sevilla")
    assert result["location"] == "Sevilla"
    assert result["uv_index"] == 6.4
    assert result["uv_level"] == "alto"
    assert result["pollen_grains_per_m3"] == {"birch": 0.0, "grass": 12.5, "mugwort": 3.0, "olive": 40.0}


async def test_tool_reports_unknown_location():
    result = await get_uv_and_pollen(Ctx(make_service({"generationtime_ms": 1})), location="Nowhere")
    assert "error" in result


@pytest.mark.parametrize(
    ("value", "level"),
    [(0, "bajo"), (2.9, "bajo"), (3, "moderado"), (5.9, "moderado"), (6, "alto"), (8, "muy alto"), (11, "extremo"), (None, "desconocido")],
)
def test_describe_uv_index(value, level):
    assert describe_uv_index(value) == level


async def test_agent_calls_tool_when_capability_is_registered():
    agent = build_assistant("test", [c for c in build_capabilities(None) if c.name == "uv_pollen"])
    with agent.override(model=TestModel(call_tools=["get_uv_and_pollen"])):
        result = await agent.run("¿Qué polen hay en Sevilla?", deps=AssistantDeps(weather=make_service()))
    returned = [
        part.content
        for message in result.all_messages()
        for part in message.parts
        if isinstance(part, ToolReturnPart) and part.tool_name == "get_uv_and_pollen"
    ]
    assert returned and returned[0]["location"] == "Sevilla"
