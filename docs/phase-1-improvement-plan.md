# Plan de cierre de la Fase 1

Documento vivo. Recoge lo que falta y lo que conviene mejorar para que MemTrace sea una buena herramienta de observabilidad y mejora continua **antes de empezar la Fase 2 (Mem)**. Complementa a [roadmap.md](roadmap.md) y a [pending-gaps.md](pending-gaps.md); cuando un punto se cierra, se marca aquí y se actualiza el roadmap.

**Leyenda**: `[ ]` pendiente · `[~]` en curso · `[x]` hecho · Prioridad **A** (alta), **M** (media), **B** (baja) · Esfuerzo **S** (días), **M** (1-2 semanas), **L** (más de 2 semanas)

---

## 1. Lo que falta (funcionalidad nueva)

| # | Estado | Tema | Qué falta | Prioridad | Esfuerzo | Depende de | ADR previsto |
|---|---|---|---|---|---|---|---|
| F1 | [ ] | **Alertas** | Reglas con umbral sobre error rate, latencia, coste y satisfacción (👍/👎), con notificación (email primero; webhook/Slack después) | A | M | — | observability |
| F2 | [ ] | **Presupuestos de coste** | Budget mensual por experimento, aviso al 80 % y al 100 %, proyección a fin de mes | A | S | F1 (reutiliza el motor de reglas) | pricing |
| F3 | [ ] | **Evaluación online** | Muestreo configurable de trazas de producción + evaluadores/juez ya existentes, scores en ClickHouse enlazados a la traza | A | L | F1 (alertar sobre caídas de score) | evaluation |
| F4 | [ ] | **Retención y PII en trazas** | Retención configurable por organización (hoy el TTL de 180 días solo cubre items de evaluación) y detección/redacción de PII en servidor | A | M | — | storage / identity |
| F5 | [ ] | **Gate de regresión en PR** | Extender el gate de despliegue (ADR-064) para que un PR no pueda fusionarse si bajan las métricas de la evaluación offline | M | M | Fase 2c de ADR-064 | governance |
| F6 | [ ] | **SDK por framework + TypeScript** | Paquetes para LangGraph y OpenAI Agents SDK; SDK TypeScript | M | L | — | sdk |
| F7 | [ ] | **Auditoría y exportación** | Registro de quién vio/exportó qué y exportación de datos de un experimento | M | M | — | identity |
| F8 | [ ] | **Operación en producción** | Backups de ClickHouse/Postgres, despliegue fuera de kind (Helm), pruebas de carga en CI | M | L | — | infra |

## 2. Pendientes ya anotados en el roadmap

| # | Estado | Tema | Pendiente | Prioridad |
|---|---|---|---|---|
| R1 | [ ] | Despliegues (ADR-064) | GitLab/Bitbucket, aprobaciones en PRO, promoción entre entornos, botón de rollback, alerta de desviación | M |
| R2 | [ ] | Aprobaciones (ADR-076) | Aviso por email a aprobadores, aprobadores por grupo/rol del IdP, reasignar, delegación | M |
| R3 | [ ] | Registro de agentes | Agentes remotos observados (`memtrace.peer_agent`) | B |
| R4 | [ ] | Prompts — evidencia (ADR-069) | Anotaciones humanas, serie temporal por versión, cohortes de tráfico | M |
| R5 | [ ] | Prompts — otros | Límites de coste/latencia en la promoción, permiso propio para la política, edición in situ de borradores, fragmentos anidados, límite de ejecuciones del playground | B |
| R6 | [ ] | Apariencia (ADR-063) | Preferencia de modo en el perfil, avatar y bienvenida, presets de tema, paleta de gráficas | B |
| R7 | [ ] | Feedback de usuario | Alertas por caída de satisfacción (ligado a F1) y satisfacción por versión de despliegue | M |

## 3. Mejoras sobre lo ya construido

| # | Estado | Área | Mejora | Prioridad | Esfuerzo |
|---|---|---|---|---|---|
| M1 | [ ] | Gráficas | Overview con **SLOs** (objetivos de error, latencia y coste con semáforo) como punto de partida para usuarios nuevos | M | M |
| M2 | [ ] | Trazas | Búsqueda por contenido (texto de entrada/salida) y comparación de dos trazas lado a lado | M | M |
| M3 | [ ] | Datasets | Importar CSV/JSONL desde el dashboard y detectar duplicados o casi duplicados | M | S |
| M4 | [ ] | Evaluaciones | Intervalos de confianza al comparar runs (con pocos items, un +3 % puede ser ruido) | M | S |
| M5 | [ ] | Costes | Coste por usuario, por conversación y por versión de prompt; tendencia con proyección | M | M |
| M6 | [ ] | Gobierno | Simplificar u ocultar por defecto «quién puede llamar a cada entorno» si no se usa (ver sección 5) | B | S |
| M7 | [ ] | Documentación | Guía «ciclo de mejora en 30 minutos»: traza → fallo → dataset → prompt → eval → deploy | M | S |

## 4. Orden propuesto

| Orden | Bloque | Contenido | Por qué en este orden |
|---|---|---|---|
| 1 | Monitor activo | F1 + F2 (+ R7) | Misma infraestructura; convierte MemTrace de visor en monitor |
| 2 | Calidad en producción | F3 | Reutiliza evaluadores y jueces; cierra el hueco offline ↔ producción |
| 3 | Confianza de datos | F4 (+ F7) | Es la barrera habitual de adopción en empresa |
| 4 | Ciclo completo | F5 + R1 + R2 | Cierra evaluación → despliegue con garantías |
| 5 | Pulido de producto | M1-M7 | Mejoran lo existente sin riesgo de arquitectura |
| 6 | Adopción y operación | F6 + F8 | Se prioriza si MemTrace sale de uso local |

## 5. Preguntas abiertas

| # | Pregunta | Impacto |
|---|---|---|
| Q1 | ¿MemTrace saldrá de local/kind y lo usarán terceros? Decide la prioridad de F4, F7 y F8 | Alto |
| Q2 | ¿Canal de notificación inicial de F1: solo email o también Slack/webhook? | Medio |
| Q3 | ¿Se mantiene el control de acceso por entorno (DEV/PRE/PRO) del ADR-053, que limita qué agentes o personas pueden llamar a cada entorno? Si nadie lo usa, ver M6 | Bajo |
| Q4 | ¿La evaluación online muestrea por porcentaje fijo o por reglas (p. ej. solo trazas con 👎)? | Medio |

## 6. Registro de cambios

| Fecha | Cambio |
|---|---|
| 2026-10-10 | Creación del documento a partir de la revisión de la Fase 1 |
