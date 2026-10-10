# Gaps pendientes

Lo que aún no cubre MemTrace, ordenado por prioridad sugerida. Complementa a [roadmap.md](roadmap.md).

## Prioridad alta

- ~~**Alertas y monitorización online**~~ — hecho ([ADR-086](adrs/observability/adr-086-alerts-and-cost-budgets.md)): umbrales sobre error rate, latencia, coste, satisfacción y gráficas guardadas, con email y campana. Pendiente: webhooks (Slack, Teams, PagerDuty) y alertar sobre la calidad de la evaluación online (depende de F3).
- **Evaluación online**: evaluar tráfico real (muestreo de trazas con evaluadores/juez). Hoy la evaluación es solo offline.
- **Gestión de prompts** (ADR-067): hecho el registro (versiones inmutables, tags por entorno, diff, historial), el SDK `prompts.get()` con handle, el enlace con trazas y la versión realmente en uso (ADR-068), la evidencia por versión (ADR-069) y la promoción con gate (ADR-070). el playground contra el asistente real (ADR-071) y del fallo al prompt con borradores (ADR-072). y fragmentos reutilizables fijados a versión (ADR-073). y mapa de dependencias con el impacto antes de promover (ADR-074). Pendiente: ver roadmap, Fase 1.8.
- **Fase 2 (Mem)**: motor de análisis, grafo de conocimiento, patrones de fallo y feedback al agente. Hoy solo se observa, no se aprende.

## Prioridad media

- ~~**Presupuestos de coste**~~ — hecho (ADR-086): presupuesto mensual por agente con avisos.
- **Cierre del ciclo de mejora**: comparar versiones (A/B o regresión) ligadas a un despliegue y bloquear el paso DEV→PRE→PRO si los evals fallan (gate de CI).
- **Más integraciones del SDK**: hay Pydantic AI y ejemplos de LangChain; faltan paquetes por framework (LangGraph, OpenAI Agents SDK…) y un SDK TypeScript.
- **Agentes remotos observados** (`memtrace.peer_agent`): pendiente en el registro de asistentes.
- ~~**Feedback de usuario final** (👍/👎)~~ — hecho, [ADR-062](adrs/observability/adr-062-end-user-feedback-on-traces.md). Las alertas sobre caídas de satisfacción están hechas (ADR-086); pendiente la satisfacción por versión de despliegue.
- **Catálogo de datos editable en servidor** para Custom charts (pendiente en Fase 1).

## Prioridad baja / transversal

- ~~**Seguridad y compliance**~~ — hecho en parte ([ADR-084](adrs/storage/adr-084-data-protection-retention-masking-audit-and-export.md)): enmascarado de PII con `****` en el SDK y en el Collector (los nombres solo los cubre el SDK), registro de auditoría y exportación. El gateway de ingesta ya comprueba que el `service.name` pertenezca a la API key ([ADR-085](adrs/identity/adr-085-ingest-gateway-validates-service-name.md)). Pendiente: guardrails sobre trazas.
- ~~**Retención configurable por organización** para trazas~~ — hecho (ADR-084): por organización y por experimento, de 1 a 365 días. Pendiente: que el dashboard consulte más de 30 días.
- **Mapeo de IdP externo** (SCIM/grupos): planificado, no cerrado ([ADR-052](adrs/identity/adr-052-permission-based-roles-and-external-identity-mapping.md)).
- **Operación en producción**: alta disponibilidad, backups de ClickHouse/Postgres, despliegue fuera de kind (Helm/cloud) y pruebas de carga automatizadas en CI (existe `load-testing/`).
