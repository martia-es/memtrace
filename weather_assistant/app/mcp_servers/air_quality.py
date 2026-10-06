"""Servidor MCP de calidad del aire (Open-Meteo). Es el servidor que consume `capabilities/air_quality.py`.

    uv run python -m app.mcp_servers.air_quality                       # stdio (lo arranca el asistente)
    uv run python -m app.mcp_servers.air_quality --http --port 8765    # HTTP, para `AIR_QUALITY_MCP_URL`
"""

import argparse

import httpx
from fastmcp import FastMCP

from app.config import Settings
from app.services.weather_service import LocationNotFoundError, WeatherService

# Escala del índice europeo de calidad del aire (EAQI).
EAQI_LEVELS = [(20, "buena"), (40, "aceptable"), (60, "moderada"), (80, "mala"), (100, "muy mala")]

mcp = FastMCP("air-quality")


def describe_eaqi(value: float | None) -> str:
    if value is None:
        return "desconocida"
    return next((label for limit, label in EAQI_LEVELS if value <= limit), "extremadamente mala")


@mcp.tool
async def get_air_quality(location: str) -> dict:
    """Devuelve la calidad del aire actual de una localidad (índice europeo EAQI y contaminantes).

    Args:
        location: Nombre de la localidad (ciudad, pueblo...), p. ej. "Madrid" o "Bilbao".
    """
    settings = Settings.from_env()
    async with httpx.AsyncClient(timeout=settings.http_timeout_seconds) as client:
        weather = WeatherService(
            client,
            geocoding_url=settings.open_meteo_geocoding_url,
            forecast_url=settings.open_meteo_forecast_url,
        )
        try:
            place = await weather.find_location(location)
        except LocationNotFoundError as error:
            return {"error": str(error)}
        response = await client.get(
            settings.open_meteo_air_quality_url,
            params={
                "latitude": place.latitude,
                "longitude": place.longitude,
                "current": "european_aqi,pm10,pm2_5,ozone,nitrogen_dioxide",
                "timezone": "auto",
            },
        )
        response.raise_for_status()
    current = response.json()["current"]
    return {
        "location": place.name,
        "country": place.country,
        "time": current["time"],
        "european_aqi": current["european_aqi"],
        "level": describe_eaqi(current["european_aqi"]),
        "pm2_5_ugm3": current["pm2_5"],
        "pm10_ugm3": current["pm10"],
        "ozone_ugm3": current["ozone"],
        "nitrogen_dioxide_ugm3": current["nitrogen_dioxide"],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--http", action="store_true")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.http:
        mcp.run(transport="http", host="127.0.0.1", port=args.port, show_banner=False)
    else:
        mcp.run(show_banner=False)
