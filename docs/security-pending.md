# Seguridad multi-tenant: lo que queda pendiente

Lista viva de lo que falta tras la [Fase 1.96](roadmap.md) (ADR-087 a ADR-093). Prioridad: **P1** = antes de abrir la plataforma a clientes reales; **P2** = endurecimiento posterior. Cuando algo se haga, bórralo de aquí y márcalo en el ADR correspondiente.

## Antes de desplegar en un entorno con datos

| # | Paso | Por qué | Comando |
|---|---|---|---|
| 1 | Migraciones de PostgreSQL (`043_partnerships`) | Tablas de partners | `make migrate-postgres` |
| 2 | Migraciones de ClickHouse (`014_experiment_id`) y usuarios | `ExperimentId`, `api_reader`, `collector`, `retention_worker` | `make migrate` |
| 3 | Backfill de `ExperimentId` | Sin él las filas antiguas son invisibles y la purga no las borra | `make backfill-experiment-id` |
| 4 | Revisar los servicios ambiguos que informa el backfill | Un `service.name` compartido queda oculto hasta decidir a quién pertenece | Salida del Job |
| 5 | Secretos reales: `INGEST_INTERNAL_TOKEN`, contraseñas de lector y collector | Los de desarrollo son públicos | `k8s/12-ingest-secret.yaml`, `k8s/10-clickhouse-secret.yaml` |
| 6 | Probar las NetworkPolicy en un clúster que las aplique (Calico/Cilium; kindnet no) | Sin CNI que las aplique no filtran | `make netpol-check` |
| 7 | Revisar la CSP en pantallas con sesión | Solo se verificó el login | Chromium contra el build |

El agente debe enviar OTLP por HTTP a la pasarela: el Collector ya no acepta gRPC.

## Dashboard

| Pendiente | Detalle | Prioridad |
|---|---|---|
| Marca de «acceso como partner» | Distintivo en la cabecera del experimento cuando el acceso viene de una consultora | P2 |
| Selector de contexto | Cuando una persona está en varias organizaciones | P2 |
| Invitación por email a gente de la consultora | Hoy la persona ya debe ser miembro de la organización partner | P2 |
| Colas de anotación con revisores partner | Los revisores no consideran grants de partner | P2 |
| Lista de accesos de un despliegue | Ignora los grants de partner | P2 |

## API

| Pendiente | Detalle | Prioridad |
|---|---|---|
| Límites de uso en el resto de la API | Solo la ingesta tiene límites (en memoria por réplica). Faltan lectura, exportación, asistentes y cuotas por tenant compartidas | P1 |
| Rutas que no pasan por `requirePermission` | Las que llaman a `authorizationService.can()` directamente no registran `partner.access` | P1 |
| Test de aislamiento en CI | `tenant-isolation.test.ts` necesita ClickHouse real; hoy se ejecuta a mano con `CLICKHOUSE_INTEGRATION=1` | P1 |
| Lecturas del personal del cliente, logins y cambios de identidad externa | No se auditan | P2 |
| Sesiones | Duración máxima, listado y cierre por la propia persona | P2 |

## Agente y SDK

| Pendiente | Detalle |
|---|---|
| Valores por defecto hacia la pasarela | El SDK debe apuntar a la pasarela y a `http/protobuf`; documentarlo |
| Mensaje del 403 | Mostrar de forma legible qué `service.name` espera la clave |
| Respuesta 429 | Reintento con espera y lotes; no perder trazas en silencio |

## Infraestructura

| Pendiente | Detalle | Prioridad |
|---|---|---|
| TLS en el ingress y HSTS | HSTS se deja al terminador TLS | P1 |
| Secretos reales y gestor de secretos con rotación | Los `*-dev-only` son públicos | P1 |
| Cifrado en reposo | Volúmenes y copias de ClickHouse y PostgreSQL | P1 |
| Endurecer pods de ClickHouse y PostgreSQL | `runAsNonRoot`, `readOnlyRootFilesystem`, Pod Security `restricted` | P1 |
| Jobs que aún usan la cuenta administradora de ClickHouse | `topic-extraction`, `model-pricing-sync`, `health-probe`, backfill, ajuste inicial del modelo | P1 |
| Alinear versiones de ClickHouse | Servidor 23.8, imagen del Job de migraciones 24.3 | P2 |
| Escaneo de la cadena de suministro en CI | Dependencias, imágenes, SBOM | P2 |

## Datos y privacidad

| Pendiente | Detalle | Prioridad |
|---|---|---|
| Borrado a petición | Por persona final, conversación o experimento entero, con rastro en la auditoría | P1 |
| Datos al terminar el contrato | Export y borrado cuando acaba la relación con un cliente | P1 |
| Alarma por filas sin `ExperimentId` | Mientras el backfill no corra son invisibles y no se purgan | P1 |
| Política de PII en el servidor | Hoy depende del SDK y del Collector; falta una política por organización al ingerir | P1 |
| Flujos hacia terceros | Jueces LLM, playground y asistentes envían contenido a proveedores externos: inventariar, mostrar y poder desactivar | P1 |
| Copias de seguridad cifradas | Con retención acorde al borrado del cliente y prueba de restauración | P2 |

## P2 y cumplimiento

Políticas de fila en ClickHouse (segunda barrera si falta el predicado de tenant), pentest externo centrado en el aislamiento entre clientes, y SOC 2 / ISO 27001 si algún cliente lo pide.

## Decisiones abiertas

| Decisión | Recomendación |
|---|---|
| ¿Rol de soporte de solo lectura para partners? | Ya resuelto en parte: un grant de partner nunca exporta. Falta decidir si hace falta además un rol más estrecho que `technical` |
| ¿Quién es dueño de los datos al terminar el contrato? | El cliente |
| ¿Contexto activo con varias organizaciones? | Selector explícito, visible en la cabecera |
| ¿Despliegue propio para clientes sensibles? | Compartido ahora; propio solo si un contrato lo exige |
