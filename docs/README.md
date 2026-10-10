# Documentación de MemTrace

Un documento por propósito. Antes de crear uno nuevo, comprueba si el contenido encaja en uno de estos.

| Necesito… | Documento | Se mantiene |
|---|---|---|
| Entender la visión, las fases y qué está hecho | [roadmap.md](roadmap.md) | Sí |
| Saber **qué falta** por hacer (única lista de pendientes) | [backlog.md](backlog.md) | Sí |
| Saber **por qué** se tomó una decisión de arquitectura | [adrs/README.md](adrs/README.md) | Sí, solo decisiones de arquitectura |
| Seguir las reglas del dashboard (tokens, temas, navegación, componentes) | [ui-conventions.md](ui-conventions.md) | Sí |
| Entender cómo se construyen las Custom charts | [custom-charts-architecture.md](custom-charts-architecture.md) | Sí |
| Ver el flujo de las colas de revisión | [annotation-queues-e2e-flow.md](annotation-queues-e2e-flow.md) | Propuesta de rediseño |
| Usar la marca (colores, tono, logo) | [brand.md](brand.md) | Sí |
| Consultar el diseño técnico original de la Fase 1 | [archive/phase_1_design.md](archive/phase_1_design.md) | No, histórico |
| Aprender a **usar** la librería o la plataforma | [docs-site/](../docs-site/) | Sí, es la documentación de usuario |

## Dónde va cada cosa nueva

| Qué he hecho | Dónde se documenta |
|---|---|
| Una funcionalidad para el usuario de la librería o de la plataforma | `docs-site/` |
| Una convención o un componente de UI | [ui-conventions.md](ui-conventions.md) |
| Una decisión de arquitectura difícil de revertir | Un ADR, o una sección nueva en uno existente |
| Algo que queda pendiente | [backlog.md](backlog.md) |
| Una fase terminada | Se marca en [roadmap.md](roadmap.md) |

`scripts/check-md-links.py` comprueba que los enlaces relativos entre documentos no estén rotos y se ejecuta en CI.
