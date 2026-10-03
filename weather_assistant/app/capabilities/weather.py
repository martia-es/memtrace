"""Capability de tiempo: consulta el clima actual y la previsión de una localidad."""

from pydantic_ai import RunContext

from app.agents.deps import AssistantDeps
from app.capabilities.base import Capability
from app.services.weather_service import (
    LocationNotFoundError,
    describe_weather_code,
)


async def get_weather(ctx: RunContext[AssistantDeps], location: str, days: int = 1) -> dict:
    """Devuelve el tiempo actual y la previsión diaria para una localidad.

    Args:
        location: Nombre de la localidad (ciudad, pueblo...), p. ej. "Madrid" o "Valencia".
        days: Número de días de previsión (1 a 7). Por defecto 1 (solo hoy).
    """
    service = ctx.deps.weather
    days = max(1, min(days, 7))
    try:
        place = await service.find_location(location)
    except LocationNotFoundError as error:
        return {"error": str(error)}

    raw = await service.current_and_forecast(place, days)
    current = raw["current"]
    daily = raw["daily"]

    return {
        "location": place.name,
        "country": place.country,
        "current": {
            "time": current["time"],
            "temperature_c": current["temperature_2m"],
            "apparent_temperature_c": current["apparent_temperature"],
            "relative_humidity_percent": current["relative_humidity_2m"],
            "precipitation_mm": current["precipitation"],
            "wind_speed_kmh": current["wind_speed_10m"],
            "condition": describe_weather_code(current.get("weather_code")),
        },
        "forecast": [
            {
                "date": date,
                "temperature_max_c": daily["temperature_2m_max"][i],
                "temperature_min_c": daily["temperature_2m_min"][i],
                "precipitation_probability_max_percent": daily["precipitation_probability_max"][i],
                "condition": describe_weather_code(daily["weather_code"][i]),
            }
            for i, date in enumerate(daily["time"])
        ],
    }


weather_capability = Capability(
    name="weather",
    description="Tiempo actual y previsión por localidad",
    instructions=(
        "Para preguntas sobre el tiempo, llama a `get_weather` con la localidad que mencione "
        "el usuario. Si no indica localidad, pregúntasela antes de llamar a la tool. "
        "Si la tool devuelve un error, díselo al usuario sin inventar datos. "
        "Responde en el idioma del usuario, de forma breve, con temperaturas en grados Celsius."
    ),
    tools=[get_weather],
)
