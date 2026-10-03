# ADR-047: Arquitectura del asistente del tiempo (Pydantic AI + FastAPI + UI estática)

* **Estado**: Aceptado
* **Fecha**: 2026-10-03

## Contexto

Necesitamos un asistente virtual que responda preguntas sobre el tiempo consultando una API externa, expuesto por una API HTTP y una UI web. El asistente es inicialmente pequeño, pero debe poder crecer con nuevas capacidades sin reescribirlo. Vive en `weather_assistant/`, fuera de la librería `memtrace` y de la plataforma, con su propio `pyproject.toml`.

## Decisiones Tomadas

1. **Agente con Pydantic AI, construido a partir de capabilities**: cada dominio (p. ej. el tiempo) es una `Capability` (instrucciones + tools + dependencias) registrada en `app/capabilities/registry.py`. `build_assistant()` no conoce dominios concretos; añadir uno no toca el agente.
2. **Dependencias explícitas (`AssistantDeps`)**: los servicios externos (cliente de Open-Meteo) se inyectan por `RunContext.deps`. Esto permite sustituirlos en tests y no acoplar las tools a un cliente global.
3. **Servicio HTTP aislado**: `WeatherService` encapsula la llamada a Open-Meteo y no conoce ni a FastAPI ni al agente. Las tools solo traducen su resultado a un dict legible por el LLM.
4. **API con FastAPI, sin estado en las rutas**: el agente, el servicio y el almacén de sesiones se crean en el `lifespan` y se guardan en `app.state`. `POST /api/chat` recibe un `session_id` opcional y devuelve la respuesta.
5. **Historial de sesiones en memoria (`SessionStore`)**: suficiente para un proceso. La interfaz se mantiene para poder sustituirla por un almacén persistente cuando haya varias réplicas.
6. **UI sin build step**: una página HTML/JS servida por FastAPI desde `static/`. Consume solo `/api/*`.
7. **Proveedor del LLM**: Google Gemini (`WEATHER_ASSISTANT_MODEL`, por defecto `google:gemini-2.5-flash`), reutilizando `GOOGLE_API_KEY` del `.env` del repo. El modelo es configurable sin cambios de código.
8. **Fuente de datos**: Open-Meteo, sin API key y con geocodificación incluida.

## Consecuencias

* **Positivas**:
  - Añadir una capacidad nueva = un módulo nuevo + una línea en el registro.
  - Las tools se pueden testear sin red ni LLM (`httpx.MockTransport` y `TestModel`).
  - Sin infraestructura adicional: un proceso uvicorn basta para desarrollar.
* **Negativas**:
  - El historial se pierde al reiniciar el proceso y no se comparte entre réplicas.
  - No hay autenticación en la API; no está pensada para exponerse fuera de local todavía.
  - Las trazas van al experimento cuya API key se define en `WEATHER_ASSISTANT_MEMTRACE_HEADERS`. Sin esa variable, el asistente no envía trazas.
