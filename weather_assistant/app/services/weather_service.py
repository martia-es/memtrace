"""Cliente de Open-Meteo (geocodificación + previsión). No conoce al agente ni a FastAPI."""

from dataclasses import dataclass

import httpx

# Códigos WMO que devuelve Open-Meteo, traducidos a texto para el LLM y el usuario.
WMO_CODES: dict[int, str] = {
    0: "despejado",
    1: "mayormente despejado",
    2: "parcialmente nublado",
    3: "nublado",
    45: "niebla",
    48: "niebla con escarcha",
    51: "llovizna ligera",
    53: "llovizna moderada",
    55: "llovizna intensa",
    61: "lluvia ligera",
    63: "lluvia moderada",
    65: "lluvia intensa",
    71: "nevada ligera",
    73: "nevada moderada",
    75: "nevada intensa",
    80: "chubascos ligeros",
    81: "chubascos moderados",
    82: "chubascos violentos",
    95: "tormenta",
    96: "tormenta con granizo ligero",
    99: "tormenta con granizo intenso",
}


class LocationNotFoundError(Exception):
    """No se encontró ninguna localidad con ese nombre."""


@dataclass(frozen=True)
class Location:
    name: str
    country: str | None
    latitude: float
    longitude: float


class WeatherService:
    def __init__(
        self,
        client: httpx.AsyncClient,
        geocoding_url: str,
        forecast_url: str,
    ) -> None:
        self._client = client
        self._geocoding_url = geocoding_url
        self._forecast_url = forecast_url

    async def find_location(self, query: str) -> Location:
        response = await self._client.get(
            self._geocoding_url,
            params={"name": query, "count": 1, "language": "es", "format": "json"},
        )
        response.raise_for_status()
        results = response.json().get("results") or []
        if not results:
            raise LocationNotFoundError(f"No se encontró la localidad '{query}'")
        first = results[0]
        return Location(
            name=first["name"],
            country=first.get("country"),
            latitude=first["latitude"],
            longitude=first["longitude"],
        )

    async def current_and_forecast(self, location: Location, days: int) -> dict:
        response = await self._client.get(
            self._forecast_url,
            params={
                "latitude": location.latitude,
                "longitude": location.longitude,
                "current": "temperature_2m,apparent_temperature,relative_humidity_2m,"
                "precipitation,wind_speed_10m,weather_code",
                "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,"
                "weather_code",
                "forecast_days": days,
                "timezone": "auto",
            },
        )
        response.raise_for_status()
        return response.json()


def describe_weather_code(code: int | None) -> str:
    if code is None:
        return "desconocido"
    return WMO_CODES.get(code, "desconocido")
