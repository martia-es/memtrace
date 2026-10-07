# Gaps pendientes

Lo que aún no cubre MemTrace, ordenado por prioridad sugerida. Complementa a [roadmap.md](roadmap.md).

## Prioridad alta

- **Alertas y monitorización online**: alertas con umbrales (error rate, latencia, coste, calidad) y notificaciones. Hoy no hay ninguna.
- **Evaluación online**: evaluar tráfico real (muestreo de trazas con evaluadores/juez). Hoy la evaluación es solo offline.
- **Gestión de prompts**: versionado y registro de prompts, enlazando cada versión con la calidad medida.
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
