# Gaps pendientes

Lo que aún no cubre MemTrace, ordenado por prioridad sugerida. Complementa a [roadmap.md](roadmap.md).

## Prioridad alta

- **Alertas y monitorización online**: alertas con umbrales (error rate, latencia, coste, calidad) y notificaciones. Hoy no hay ninguna.
- **Evaluación online**: evaluar tráfico real (muestreo de trazas con evaluadores/juez). Hoy la evaluación es solo offline.
- **Gestión de prompts** (ADR-067): hecho el registro (versiones inmutables, tags por entorno, diff, historial), el SDK `prompts.get()` con handle, el enlace con trazas y la versión realmente en uso (ADR-068), la evidencia por versión (ADR-069) y la promoción con gate (ADR-070). el playground contra el asistente real (ADR-071). Pendiente: del fallo al prompt, fragmentos y mapa de dependencias (ver roadmap, Fase 1.8).
- **Fase 2 (Mem)**: motor de análisis, grafo de conocimiento, patrones de fallo y feedback al agente. Hoy solo se observa, no se aprende.

## Prioridad media

- **Presupuestos de coste**: existe el catálogo de precios, pero faltan budgets por experimento y avisos.
- **Cierre del ciclo de mejora**: comparar versiones (A/B o regresión) ligadas a un despliegue y bloquear el paso DEV→PRE→PRO si los evals fallan (gate de CI).
- **Más integraciones del SDK**: hay Pydantic AI y ejemplos de LangChain; faltan paquetes por framework (LangGraph, OpenAI Agents SDK…) y un SDK TypeScript.
- **Agentes remotos observados** (`memtrace.peer_agent`): pendiente en el registro de asistentes.
- ~~**Feedback de usuario final** (👍/👎)~~ — hecho, [ADR-062](adrs/observability/adr-062-end-user-feedback-on-traces.md). Pendiente de este bloque: alertas sobre caídas de satisfacción y satisfacción por versión de despliegue.
- **Catálogo de datos editable en servidor** para Custom charts (pendiente en Fase 1).

## Prioridad baja / transversal

- **Seguridad y compliance**: detección de PII y guardrails sobre trazas (hoy solo redacción en el SDK), exportación y auditoría de accesos.
- **Retención configurable por organización** para trazas (el TTL de 180 días aplica solo a items de evaluación).
- **Mapeo de IdP externo** (SCIM/grupos): planificado, no cerrado ([ADR-052](adrs/identity/adr-052-permission-based-roles-and-external-identity-mapping.md)).
- **Operación en producción**: alta disponibilidad, backups de ClickHouse/Postgres, despliegue fuera de kind (Helm/cloud) y pruebas de carga automatizadas en CI (existe `load-testing/`).
