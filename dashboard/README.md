# memtrace-dashboard

Dashboard de MemTrace (pieza 5 del roadmap). Consume **solo** la API de consulta ([`api/`](../api)); nunca accede a ClickHouse. Convenciones de UI: [docs/ui-conventions.md](../docs/ui-conventions.md). Decisiones de arquitectura: [índice de ADRs](../docs/adrs/README.md).

## Arrancar

Necesita el stack (`make up`) y la API en marcha (`cd api && npm run dev`, puerto 3001):

```bash
npm install
npm run dev        # http://localhost:5173  (el proxy /api → http://localhost:3001)
```

Para generar datos de prueba: `MEMTRACE_CAPTURE_CONTENT=true python examples/02_multi_step_agent.py`.

| Pantalla | |
|---|---|
| **Conversaciones** (`/conversations`) | pantalla principal (ADR-017): KPIs y lista de **trazas**; el interruptor "Agrupar por conversación" (`?group=conversation`) muestra una fila por conversación. Filtros por rango, agente y errores, y modo "en vivo" |
| **Conversación** (`/conversations/:id`) | trazas de esa conversación (usa el mensaje del usuario como etiqueta si hay contenido capturado). Interruptor **Table / Tree** (`?view=tree`, ADR-012): árbol de spans de cada turno apilado, con el mismo inspector que la vista de traza |
| **Traza** (`/traces/:id`) | izquierda, árbol de spans con barras de tiempo; derecha, input, output y metadata del span elegido (`?span=` en la URL). Requiere `MEMTRACE_CAPTURE_CONTENT=true` para ver el contenido |
| **Métricas** (`/metrics`) | KPIs, actividad y latencia p95, tokens por intervalo, uso por modelo y por herramienta |

**Tiempo real**: el listado y las métricas se actualizan solos (selector `Off / 5 s / 10 s / 30 s`, por defecto 5 s, recordado en el navegador). Se pausa con la pestaña oculta y refresca al volver; no apila peticiones; conserva las páginas cargadas con "Cargar más" y resalta las trazas nuevas. El detalle de una traza en curso se actualiza hasta que llega su span raíz. Retraso medido hasta verla en pantalla: ~4 s (el agente vacía al salir), ~10 s con un agente de larga vida y el lote del SDK por defecto (5 s), ~5 s con `MEMTRACE_BATCH_SCHEDULE_DELAY_MS=1000`.

Los filtros y el span seleccionado viven en la URL: cualquier vista se puede compartir. Tema claro/oscuro/automático en la cabecera.

## Arquitectura (hexagonal, ADR-011)

```
src/
  domain/                 formato, rangos, layout de la cascada   (TS puro)
  application/            puerto TraceApi
  adapters/outbound/      HttpTraceApi: el único que hace fetch
  ui/                     páginas, componentes y composables Vue
  dependency-container.ts composition root
```

Los tipos de la respuesta se importan de la API con el alias `@contract` (solo tipos), sin copiarlos.

## Scripts y configuración

| Comando | |
|---|---|
| `npm run dev` / `npm run preview` | servidor con proxy a la API |
| `npm run build` | comprueba tipos (`vue-tsc`) y genera `dist/` |
| `npm test` | dominio, adapter HTTP, composables, páginas y regla de dependencias |

| Variable | Defecto | |
|---|---|---|
| `MEMTRACE_API_URL` | `http://localhost:3001` | destino del proxy de Vite |
| `VITE_API_BASE_URL` | `/api/v1` | base que usa el navegador (cámbiala solo si no hay proxy) |
