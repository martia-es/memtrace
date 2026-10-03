import httpx
import pytest
from pydantic_ai import models
from pydantic_ai.messages import ToolReturnPart
from pydantic_ai.models.test import TestModel

from app.agents.assistant import build_assistant
from app.agents.deps import AssistantDeps
from app.capabilities.registry import ALL_CAPABILITIES
from app.services.weather_service import WeatherService

models.ALLOW_MODEL_REQUESTS = False

GEOCODING = {"results": [{"name": "Madrid", "country": "España", "latitude": 40.4, "longitude": -3.7}]}
FORECAST = {
    "current": {
        "time": "2026-10-03T12:00",
        "temperature_2m": 21.5,
        "apparent_temperature": 20.8,
        "relative_humidity_2m": 40,
        "precipitation": 0.0,
        "wind_speed_10m": 9.1,
        "weather_code": 1,
    },
    "daily": {
        "time": ["2026-10-03", "2026-10-04"],
        "temperature_2m_max": [24.0, 22.0],
        "temperature_2m_min": [12.0, 11.0],
        "precipitation_probability_max": [10, 60],
        "weather_code": [1, 61],
    },
}


def make_service(geocoding: dict, forecast: dict | None = None) -> WeatherService:
    def handler(request: httpx.Request) -> httpx.Response:
        if "geocoding" in request.url.host:
            return httpx.Response(200, json=geocoding)
        return httpx.Response(200, json=forecast or FORECAST)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return WeatherService(
        client,
        geocoding_url="https://geocoding-api.open-meteo.com/v1/search",
        forecast_url="https://api.open-meteo.com/v1/forecast",
    )


async def test_get_weather_tool_returns_structured_data():
    agent = build_assistant("test", ALL_CAPABILITIES)
    deps = AssistantDeps(weather=make_service(GEOCODING))

    with agent.override(model=TestModel(call_tools=["get_weather"])):
        result = await agent.run("¿Qué tiempo hace en Madrid?", deps=deps)

    tool_return = next(
        part.content
        for message in result.all_messages()
        for part in message.parts
        if isinstance(part, ToolReturnPart) and part.tool_name == "get_weather"
    )
    assert tool_return["location"] == "Madrid"
    assert tool_return["current"]["condition"] == "mayormente despejado"
    assert tool_return["forecast"][1]["condition"] == "lluvia ligera"


async def test_get_weather_tool_reports_unknown_location():
    from app.capabilities.weather import get_weather

    class Ctx:
        deps = AssistantDeps(weather=make_service({"generationtime_ms": 1}))

    result = await get_weather(Ctx(), location="Nowhere")
    assert "error" in result


async def test_days_are_clamped():
    from app.capabilities.weather import get_weather

    seen: dict = {}
    service = make_service(GEOCODING)
    original = service.current_and_forecast

    async def spy(place, days):
        seen["days"] = days
        return await original(place, days)

    service.current_and_forecast = spy

    class Ctx:
        deps = AssistantDeps(weather=service)

    await get_weather(Ctx(), location="Madrid", days=99)
    assert seen["days"] == 7


@pytest.mark.parametrize("capability_name", ["weather"])
def test_registry_contains_capability(capability_name):
    assert capability_name in {c.name for c in ALL_CAPABILITIES}
