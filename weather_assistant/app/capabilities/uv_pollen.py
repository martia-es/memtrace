"""Capability de UV y polen: índice UV actual y concentración de polen de una localidad."""

from pydantic_ai import RunContext

from app.agents.deps import AssistantDeps
from app.capabilities.base import Capability
from app.services.weather_service import (
    POLLEN_FIELDS,
    LocationNotFoundError,
    describe_uv_index,
)


async def get_uv_and_pollen(ctx: RunContext[AssistantDeps], location: str) -> dict:
    """Devuelve el índice UV actual y la concentración de polen de una localidad.

    Args:
        location: Nombre de la localidad (ciudad, pueblo...), p. ej. "Sevilla" o "Valencia".
    """
    service = ctx.deps.weather
    try:
        place = await service.find_location(location)
    except LocationNotFoundError as error:
        return {"error": str(error)}

    current = (await service.uv_and_pollen(place))["current"]
    uv_index = current["uv_index"]
    # Open-Meteo devuelve null para los tipos de polen sin datos en esa zona.
    pollen = {
        field.removesuffix("_pollen"): current[field] for field in POLLEN_FIELDS if current.get(field) is not None
    }
    return {
        "location": place.name,
        "country": place.country,
        "time": current["time"],
        "uv_index": uv_index,
        "uv_level": describe_uv_index(uv_index),
        "pollen_grains_per_m3": pollen,
    }


uv_pollen_capability = Capability(
    name="uv_pollen",
    description="Índice UV y polen por localidad",
    instructions=(
        "Para preguntas sobre el índice UV, la radiación solar, el polen o las alergias, llama a "
        "`get_uv_and_pollen` con la localidad que mencione el usuario. Si `pollen_grains_per_m3` viene "
        "vacío, di que no hay datos de polen para esa zona. Si la tool devuelve un error, díselo "
        "sin inventar datos."
    ),
    tools=[get_uv_and_pollen],
)
