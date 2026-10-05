"""Servicio del tiempo determinista para evaluar al asistente sin depender de Open-Meteo.

Con datos fijos, el dataset puede afirmar cifras concretas ("Madrid, 21 °C") y una caída de
la métrica significa que cambió el agente, no el tiempo. Mismo interfaz que `WeatherService`.
Las temperaturas son enteros a propósito: el LLM las escribe igual con "21", "21.0" o "21,0".
"""

import unicodedata
from datetime import date, timedelta

from app.services.weather_service import Location, LocationNotFoundError, WeatherService

START = date(2026, 10, 4)


def _normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold().strip()


# Cada ciudad: coordenadas, tiempo actual y 7 días de previsión (códigos WMO de Open-Meteo).
CITIES: dict[str, dict] = {
    "madrid": {
        "name": "Madrid", "lat": 40.4, "lon": -3.7,
        "current": dict(temperature_2m=21.0, apparent_temperature=20.0, relative_humidity_2m=40,
                        precipitation=0.0, wind_speed_10m=9.0, weather_code=1),
        "max": [24, 22, 20, 19, 21, 23, 24], "min": [12, 11, 10, 9, 10, 11, 12],
        "rain": [10, 60, 70, 30, 10, 0, 0], "code": [1, 61, 63, 3, 2, 1, 0],
    },
    "valencia": {
        "name": "València", "lat": 39.5, "lon": -0.4,
        "current": dict(temperature_2m=24.0, apparent_temperature=25.0, relative_humidity_2m=65,
                        precipitation=0.0, wind_speed_10m=14.0, weather_code=2),
        "max": [25, 24, 23, 22, 24, 25, 26], "min": [17, 16, 15, 14, 15, 16, 17],
        "rain": [20, 70, 30, 10, 0, 0, 10], "code": [2, 63, 3, 2, 1, 0, 1],
    },
    "sevilla": {
        "name": "Sevilla", "lat": 37.4, "lon": -6.0,
        "current": dict(temperature_2m=33.0, apparent_temperature=34.0, relative_humidity_2m=25,
                        precipitation=0.0, wind_speed_10m=8.0, weather_code=0),
        "max": [34, 35, 36, 35, 33, 32, 33], "min": [20, 21, 22, 21, 20, 19, 20],
        "rain": [0, 0, 0, 0, 5, 0, 0], "code": [0, 0, 0, 1, 1, 0, 0],
    },
    "bilbao": {
        "name": "Bilbao", "lat": 43.3, "lon": -2.9,
        "current": dict(temperature_2m=15.0, apparent_temperature=13.0, relative_humidity_2m=88,
                        precipitation=2.4, wind_speed_10m=18.0, weather_code=63),
        "max": [16, 17, 15, 14, 16, 18, 17], "min": [11, 12, 10, 9, 10, 12, 11],
        "rain": [90, 80, 60, 40, 30, 20, 20], "code": [63, 61, 61, 3, 3, 2, 2],
    },
    "barcelona": {
        "name": "Barcelona", "lat": 41.4, "lon": 2.2,
        "current": dict(temperature_2m=23.0, apparent_temperature=24.0, relative_humidity_2m=70,
                        precipitation=0.0, wind_speed_10m=12.0, weather_code=3),
        "max": [24, 24, 22, 23, 25, 25, 24], "min": [18, 18, 16, 16, 17, 18, 18],
        "rain": [30, 85, 40, 10, 0, 0, 10], "code": [3, 95, 3, 2, 1, 1, 2],
    },
    "granada": {
        "name": "Granada", "lat": 37.2, "lon": -3.6,
        "current": dict(temperature_2m=12.0, apparent_temperature=10.0, relative_humidity_2m=55,
                        precipitation=0.0, wind_speed_10m=15.0, weather_code=2),
        "max": [15, 14, 4, 6, 9, 11, 12], "min": [3, 2, -2, -1, 1, 2, 3],
        "rain": [10, 20, 80, 50, 10, 0, 0], "code": [2, 3, 73, 71, 3, 2, 1],
    },
    "malaga": {
        "name": "Málaga", "lat": 36.7, "lon": -4.4,
        "current": dict(temperature_2m=26.0, apparent_temperature=27.0, relative_humidity_2m=60,
                        precipitation=0.0, wind_speed_10m=11.0, weather_code=1),
        "max": [27, 27, 26, 25, 26, 27, 28], "min": [19, 19, 18, 17, 18, 19, 20],
        "rain": [0, 0, 10, 10, 0, 0, 0], "code": [1, 1, 2, 2, 1, 0, 0],
    },
}


class FakeWeatherService(WeatherService):
    def __init__(self) -> None:  # sin cliente HTTP: nunca sale a la red
        pass

    async def find_location(self, query: str) -> Location:
        # Acepta el nombre con o sin acentos y con país ("Valencia, España").
        key = _normalize(query.split(",")[0])
        key = {"valència": "valencia"}.get(key, key)
        city = CITIES.get(key)
        if city is None:
            raise LocationNotFoundError(f"No se encontró la localidad '{query}'")
        return Location(name=city["name"], country="España", latitude=city["lat"], longitude=city["lon"])

    async def current_and_forecast(self, location: Location, days: int) -> dict:
        city = next(c for c in CITIES.values() if c["name"] == location.name)
        dates = [(START + timedelta(days=i)).isoformat() for i in range(days)]
        return {
            "current": {"time": f"{START.isoformat()}T12:00", **city["current"]},
            "daily": {
                "time": dates,
                "temperature_2m_max": [float(v) for v in city["max"][:days]],
                "temperature_2m_min": [float(v) for v in city["min"][:days]],
                "precipitation_probability_max": city["rain"][:days],
                "weather_code": city["code"][:days],
            },
        }
