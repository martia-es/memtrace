# Convenciones de UI del dashboard

Reglas vigentes del dashboard (`dashboard/`). El sistema de diseño de base sigue en [ADR-048](adrs/ui/adr-048-mediterranean-design-system-and-simplified-navigation.md) y la identidad de marca en [brand.md](brand.md).

## 1. Tokens y temas

| Tema | Regla |
|---|---|
| Colores | Todo color compartido es un token `--mt-*` definido una vez en `src/styles/app.css`. Los componentes solo consumen `var(--mt-*)`. |
| Modo oscuro | Se implementa como una segunda tanda de valores de los mismos tokens. El estado vive en `useTheme.ts` (`light` / `dark`, persistido en `localStorage` como `memtrace.theme`). No se detecta `prefers-color-scheme`: elige la persona. |
| Radios | Escala de tres pasos: `--mt-radius-xs` (4 px, chips), `--mt-radius-sm` (6 px, botones, inputs, pills) y `--mt-radius-lg` (8 px, tarjetas, modales). Nada de radios literales. |
| Tema por organización | `organizations.theme` (JSONB) guarda `accentColor`, `secondaryColor`, `radiusPreset` (`sharp` / `soft` / `round`), `fontPreset` (`system` / `serif` / `humanist`, lista cerrada de pilas del sistema), `assistantName`, `assistantDefaultMode` y `assistantAllowedModes`. `null` significa «valor por defecto de MemTrace». |
| Aplicación del tema | Una sola función, `themeCssVars(theme)`, convierte el tema en variables CSS; `applyOrganizationTheme` las escribe en `:root` y el formulario de apariencia reutiliza el mismo objeto para su vista previa. El color de texto sobre el acento se calcula por luminancia (WCAG). |
| Fuera del tema | Logo, favicon y colores de spans/gráficas (`palette.ts`) son identidad de MemTrace y no se configuran. No hay fuentes arbitrarias ni carga de fuentes externas (CSP, privacidad). |

## 2. Navegación

- La barra lateral agrupa las entradas por intención en tres bloques con título (Observe: Overview, Conversations, Analytics · Watch: Alerts & budget · Improve: Review, Prompts, Evaluations) más Workspace (Assistants, Model pricing) abajo; los títulos se declaran con `heading` en `NAV` y plegado quedan como línea separadora. Overview es solo la portada: las herramientas de análisis cuelgan de Analytics. Lo global (Assistants, Model pricing) vive en Workspace, no entre las secciones del agente. Una sección puede tener hijos, cada uno con su propia URL. Se expande el grupo de la página actual. El árbol vive en `NAV` (`MainLayout.vue`) y cada ruta marca su entrada con `meta.section`.
- **No hay pestañas dentro de las páginas** para navegar por la app. Solo las usan las páginas de detalle de un objeto (dataset: Items / Versions / Runs, asistente, admin), porque son secciones de una misma cosa.
- Toda vista es enlazable y sobrevive a un reload; el rango y los filtros viajan en la query del enlace.
- Barra superior global (52 px) con dos huecos, izquierdo (migas / título) y derecho (filtros y acciones). Las páginas no pintan cabecera: usan `PageHeader` / `TopbarSlot`, que teletransporta al hueco (`useTopbar`). Sin topbar (tests), el contenido se pinta en su sitio. `FilterBar` es el control de rango (presets + «Custom»).
- Admin es jerárquico, un nivel por URL: `/admin` (organizaciones) → `/admin/organizations/:id` (Experiments, Members, Approvals, Data protection, Partners, Identity, Appearance) → `/admin/experiments/:id` (Connect, API keys, Score configs, Members). Las acciones se muestran o se ocultan según `myRole`; el backend es quien impone el permiso.
- **Menú contextual de Settings**: en `/admin/organizations/:id` las secciones de la organización no son pestañas, sustituyen al menú principal en el mismo sidebar (grupos Workspace / Governance / Organization, enlace «Back to app» arriba). La página las registra con `useSettingsNav` y `MainLayout` las pinta mientras estén registradas; la sección activa viaja en `?tab=`. Un menú nuevo de este tipo = registrar secciones desde la página, no añadir un segundo sidebar.
- **Filtros en vez de submenú para la misma entidad**: si varias entradas del sidebar solo muestran la misma lista con otro recorte (p. ej. Review: asignadas a mí / todas, activas / archivadas), son una sola pantalla con filtros (`SegmentedControl`) guardados en la query de la URL (`?scope=all`, `?status=archived`; el valor por defecto no se escribe). Las rutas antiguas redirigen al filtro equivalente. Submenú solo cuando cada entrada es una pantalla con contenido propio.

## 3. Componentes propios

Los controles son componentes propios; Quasar queda solo para el armazón de página (`q-layout`, `q-page-container`, `q-page`), los iconos (`q-icon`) y los plugins `Notify` y `Dark`. Un test guardián falla si aparece otro `<q-*>`.

| Componente | Uso |
|---|---|
| `Button` | Único botón de acción: `variant` = `primary` / `secondary` / `danger` / `link` / `icon`, `size` = `md` / `sm`, `loading`, `to` para enlaces. Por defecto `type="button"`. El posicionamiento (`margin-left: auto`) lo pone el padre. |
| `Checkbox`, `Radio` | Mismo contrato (`v-model`, `value`); `Checkbox` admite `variant="switch"`. |
| `Pill` | Estado y etiquetas: `tone` = `neutral` / `ok` / `error` / `warn` / `info` / `highlight` / `accent`, más `outline`, `mono`, `dot`. `StatusChip` es un `Pill` con punto. |
| `DataTable` | Cabecera, borde de fila y hover; el contenido (`thead` / `tbody`) lo pone la página. `bare`, `sticky`, `density="sm"`, `nowrap`. |
| `Card`, `Pagination`, `FormField` | Superficie con borde, paginador y campo con etiqueta, pista y error. Los estilos base usan `:where()` para que una página pueda sobrescribir una propiedad sin subir especificidad. |
| `SegmentedControl`, `ToggleChip`, `Disclosure`, `TabPanel`, `TabBar` | Grupos segmentados, filtros, secciones plegables y pestañas de detalle. |
| `Menu`, `MenuItem`, `Modal`, `LoadingState` | Popover, diálogo (con slot `footer`) y estado de carga centrado de una zona. |
| `Spinner` | Único indicador de carga: el logo animado (trazas que se funden en una barra coral). `size` = `sm` / `md` / `lg`; `tone` = `brand` (colores del logo sobre el fondo, por defecto) o `current` (color del texto, para botones y controles). No dibujes spinners propios; `Button loading` y `Select loading` ya lo usan. |

Un `<button>` crudo solo se admite en las interioridades de estos componentes y en piezas cuyo diseño es el botón entero (disparadores de popover, filas desplegables, cabeceras ordenables, respuestas con atajo de teclado, botones OAuth). La lista, con su motivo, está en `Widgets.test.ts`.

## 4. Gráficas personalizadas

- El modelo guardado (`CustomMetricDefinition`) no cambia: guarda `step_type`, claves de atributo y métricas cerradas. Por eso renombrar nada rompe gráficas ni informes ya guardados.
- La presentación pasa por un único módulo puro, `domain/custom-chart-vocabulary.ts`: nombre editado → diccionario integrado → identificador «humanizado».
- «Empieza por una pregunta»: plantillas que son `CustomMetricDefinition` normales, ofrecidas solo si existen los pasos necesarios en el rango. Flujo en tres pasos (qué medir, cómo verlo, guardar) con vista previa en vivo. Los atributos técnicos (`memtrace.*`, `otel.*`, `gen_ai.usage.*`) quedan tras «Show technical details».
- Objetivos del Overview (M1): errores, latencia y coste llevan una `Pill` con punto (verde `ok`, ámbar `warn` desde el 90 % del límite, roja `error`, gris `neutral` si no hay dato) y una línea «Goal …» que enlaza a Alerts. La lógica vive en `domain/goals.ts`; un objetivo no es un modelo nuevo, es una regla de alerta o el presupuesto (ADR-086).
- **Spend this month** (M5, `CostTrendCard`): una fila entre Activity y el resto de tarjetas del Summary, con o sin presupuesto, siempre que haya gasto este mes. Sin presupuesto no hay línea ni día de cruce, el estado es `neutral` «No budget set» y el hueco del presupuesto ofrece «Set a budget →» solo con `alert:manage`. Izquierda, gasto acumulado del mes natural (no sigue al rango del Overview) con barras por día, línea de presupuesto discontinua y proyección punteada hasta fin de mes; derecha, «Where it goes» (usuario, versión de prompt o entorno) con el reparto de `getBreakdown` del día 1 a hoy. El estado es una `Pill` (`ok` On track, `warn` Forecast over budget, `error` Exceeded, `neutral` Too early to project) y el KPI de coste pasa a ámbar con «Forecast over» y «projected $X». Toda la lógica vive en `domain/cost-trend.ts` (función pura sobre `BudgetViewDto`); la API añade `monthCost` (gasto del mes, previsión y coste diario) a la vista general de Alerts, sin endpoint nuevo.
- El catálogo editable ([ADR-078](adrs/ui/adr-078-editable-chart-catalog.md)) es la misma tabla (`ChartCatalogTable`) en tres sitios: modal «Customize names», renombrado en el sitio sobre cada chip de paso y la página **Overview › Data catalog**. Editar exige `catalog:manage`; verlo, `experiment:read`.

## 5. Prompts: lista y detalle

- La lista es una sola tabla blanca (`DataTable bare`, sin caja ni tinte: la página usa `--mt-card`): `Name | Latest | DEV | PRE | PRO | Updated`, con prompts y fragmentos mezclados (un icono y una etiqueta junto al nombre los distinguen; no hay columna Type). Cada entorno es un punto de estado más la versión (`--mt-accent` al día, `--mt-highlight` por detrás con «N behind»); una leyenda bajo la tabla lo explica y «Open →» aparece al pasar el ratón. El estado se lee en la fila y se filtra con un `SegmentedControl` (Type) y `ToggleChip` (Status, volver a pulsar lo quita) (`?type=fragment`, `?status=behind`, el valor por defecto no se escribe). «Show archived» vive en el menú ⋯. Todo se deriva de lo que la lista ya devuelve (`latestVersion`, `tags`).
- No uses la clase `row` en una fila de tabla: Quasar la define como `display:flex` y rompe las columnas (`prompt-row`).
- Un `Select` dentro de un contenedor que se encoge hereda su ancho: ponle un contenedor con ancho fijo (`filter-select`) o la lista de opciones sale estrecha.
- El detalle de un prompt: arriba, tres tarjetas de entorno en horizontal (versión grande, estado, lo que reportan los agentes y acción «Promote vN» / «Request approval») y los tags libres como chips; debajo, a la izquierda, la versión elegida con pestañas **de esa versión** (`TabBar`: Prompt, Compare, Test) y, a la derecha, la lista de versiones como línea de tiempo (`PromptVersionList`: buscador, agrupadas por mes, un punto por versión unido por un hilo). Compare junta el diff y el comportamiento (la tabla de todas las versiones va plegada con `Disclosure`). Test ofrece «A message» / «A failed trace» con un `SegmentedControl`. Cada dato vive en un solo sitio: los entornos y tags se gestionan solo desde las tarjetas (el ⋯ de cada una despliega su panel en línea; no uses `Menu`, que se teletransporta al body).
- Lo que no es de una versión (reglas y aprobaciones, actividad, quién lo usa) va en un único panel lateral, «Release rules» (política, aprobaciones, historial), que se abre desde la cabecera (`?tab=` antiguo lo abre). Mismo patrón para cualquier otra información secundaria de un objeto: panel lateral, no una pestaña más.
- Las reglas de «detrás» y de agrupación son funciones puras en `domain/prompt-release.ts`; `EnvFlag` pinta la etiqueta de entorno.
- Un mensaje de versión vacío no se pinta («No message» no aporta nada).
- Limitación: la tabla asume los tres entornos habituales; con otros nombres las etiquetas extra salen junto al nombre.

## 6. Asistente embebido

Tres modos de visualización: `bubble` (ventana flotante), `dock` (panel lateral que empuja el contenido) y `fullscreen` (ruta `/assistant` en pestaña nueva, abierta dentro del gesto de clic para que el navegador no la bloquee). `resolveMode(theme, userMode)` elige la preferencia personal si la organización la permite, si no el modo por defecto de la organización y, si no, la burbuja. La preferencia personal vive en `localStorage`, no en el perfil.

## 7. Run offline (dataset)

- Un botón de icono `</>` (no «Run offline»: no ejecuta nada) en la cabecera del dataset abre un modal a pantalla completa (`RunOfflineModal`): a la izquierda dataset/versión, métricas y entorno del agente; a la derecha el script, el `.env` y los comandos de instalación con Copy/Download.
- El texto sale de funciones puras en `domain/eval-script.ts` (`buildEvalScript`, `buildEvalEnv`, `buildEvalInstall`); no hay endpoint nuevo. El host sale del despliegue y el contrato JSON de `chat` de la ficha del agente (ADR-055). Sin chat declarado, el script trae una función para rellenar.
- El código se pinta con `CodeBlock` (resaltador propio en `domain/code-highlight.ts`, sin dependencias) y los tokens `--mt-code-*` de `app.css`, con valores claros y oscuros. Usarlo para cualquier bloque de código nuevo.
- Sin runs, **Evaluations › Runs** y la pestaña Runs del dataset muestran `OfflineRunSteps` (tres pasos) en vez de un estado vacío de una línea.
- **Nunca lleva secretos**: la API key de MemTrace, la de Anthropic y el token del agente son marcadores `PASTE_…` y el modal avisa de cuáles faltan. Solo se ofrecen métricas que funcionan con el agente corriendo en otro proceso (`exact_match`, `contains`, `Correctness`); Faithfulness y las de retrieval necesitan el contexto en el mismo proceso.

## 8. Datasets (ficheros y hoja)

- **Evaluations › Datasets** es una cuadrícula de tarjetas-fichero (miniatura de hoja, nombre, `vX.Y`, items · runs, última edición; las más recientes primero) con un `SegmentedControl` Files / List. La preferencia vive en `localStorage` (`mt.datasets.view`), como el modo del chat. La tarjeta es un `<button>` propio (tarjeta pulsable, en la lista blanca de `Widgets.test.ts`); borrar es un `Button` de icono que aparece al pasar el ratón y siempre pide confirmación.
- Soltar un `.csv` (o elegirlo con la tarjeta punteada) crea el dataset con `itemsFromCsv` (`dataset-draft.ts`): cabecera `input` / `expected_output` o, sin ella, columnas por posición; separador `,` `;` o tab. Un `.xlsx` no se lee: se pide exportar a CSV. Crea el dataset y publica los items con `POST .../changes`, así que queda como v2.0 como cualquier alta.
- **Items** (`DatasetItemsEditor`) imita una hoja sin ser una: cabeceras con letra (A Input, B Expected output, C Last edit), caja de nombre con la celda activa (`B3`), barra de fórmulas de solo lectura con el texto completo y barra de estado (items, selección, cambios desde la versión). La celda activa es la que tiene el foco; no hay fórmulas ni selección de rangos. Las pestañas Items / Versions / Runs siguen arriba (son secciones de un mismo objeto, ver sección 1).
- **Items con conversación**: si el valor de una celda es una lista de mensajes que reconoce algún adaptador de `span-io.ts` (`role`+`content`, `parts`…), `conversationPreview` (`domain/conversation-preview.ts`) la muestra como chip `chat · N` + una línea (último mensaje `user` en Input, último `assistant` en Expected output). La celda pasa a ser un `textarea` de solo lectura: un clic, o «Edit in details» en la barra de fórmulas, abre el modal con pestañas Messages / JSON as saved / Metadata (`TabBar` + `MessageBlock`). El JSON guardado nunca se reescribe desde la vista; se edita en la pestaña JSON. Si ningún adaptador lo reconoce, la celda sigue siendo texto editable. Sin esquema ni API nuevos.
- Sin carpetas: `datasets` no tiene dónde agruparse y no se añade esquema para ello por ahora.

## Cómo añadir cosas

- Una sección nueva = un hijo en `NAV` (en el bloque cuya pregunta responde: observar, vigilar o mejorar) + una ruta con su `meta.section`.
- Un control nuevo = primero buscar si ya existe en la tabla de componentes; si no, crearlo allí y añadirlo a esta tabla.
- Un color nuevo = un token `--mt-*` con valor claro y oscuro; nunca un hex dentro de un componente.
- Un solo acento por pantalla: tarjetas y paneles son neutros (blanco + `--mt-line`) y `--mt-accent` aparece solo en lo seleccionado o en hover. Los tonos rojo/ámbar/verde se reservan para estados (error, aviso, correcto), nunca para decorar listas (ejemplo: preguntas de Analítica › Gráficas).

## 11. Idiomas (en / es)

- El inglés es el idioma fuente. Los textos de la interfaz viven en `src/ui/i18n/en.ts` y `es.ts` (claves planas `area.nombre`, marcadores `{nombre}`); `es.ts` está tipado contra `en.ts` y `tests/ui/i18n.test.ts` exige las mismas claves y marcadores. Un texto nuevo = una clave en los dos catálogos.
- Se usa con `t("clave", { param })` de `ui/i18n` (módulo propio, sin plugin: funciona en tests sin montarlo). El idioma activo es un `ref` compartido, persistido en `memtrace.locale`; por defecto el del navegador (`es*` → español, el resto inglés). Se cambia desde el menú de usuario y actualiza `<html lang>` y el paquete de idioma de Quasar.
- Las tablas de datos con textos (p. ej. `NAV`) guardan la clave y traducen al pintar, no al declarar.
- El dominio traduce con `tr()` / `lazyMessages()` (`domain/translate.ts`, un puerto que registra `ui/i18n`); las constantes con etiquetas usan `get label()` o `lazyMessages` para seguir el idioma activo. Un `v-for="t in …"` tapa la función `t`: renombra la variable.
- Fechas y números siguen el idioma activo: `domain/format.ts` usa `perLocale()` (locale registrado por `ui/i18n`) y la UI usa `dateLocale()`.

## 6. Costs › Model pricing: calidad y confirmación de coincidencias

- La tabla de precios gana una columna **Quality · Arena Elo** (`domain/model-quality.ts` decide qué dice cada celda: puntuación, candidato, sin equivalente o no disponible). Una celda con candidato lleva el nombre de Arena y un botón «Confirm match →»; quien no puede decidir (`pricing:manage`) ve «Awaiting confirmation». Antes de la primera sincronización la columna no se pinta y los precios funcionan igual.
- Los filtros «All models / In use / Needs review» son un `SegmentedControl` cuyo valor va en la query (`?show=in_use`, `?show=review`); «todos» no se escribe. «In use» se refiere al agente que se estaba mirando (el último o el primero legible), porque esta página no cuelga de un experimento.
- El panel «Confirm Arena matches» (`ModelMatchDrawer`) es un panel lateral como el de las reglas de un prompt: se abre desde el banner, desde un botón de fila o con `?review=1` (el aviso de la campana), y al cerrar quita `?review`. Una decisión vale para toda la organización y se explica en el propio panel.
- La pestaña **Models** de la campana solo aparece si hay modelos pendientes y cuenta como una unidad en el número de la campana. Es estado vivo (sin hora ni marca de leído) y no se envía por email.
- Atribución obligatoria: bajo la tabla se nombra a Arena, se enlaza, se da la fecha del leaderboard y la licencia (CC BY 4.0), y se dice que el Elo mide preferencia en chat, no precisión en la tarea.

## 9. Overview › Breakdown: comparar en pares

- La página es **una sola `Card` blanca** sobre fondo `--mt-soft-2`: cabecera con «Group by» (`SegmentedControl`), aviso, huecos A/B, tabla y comparación dentro de la misma tarjeta. Sin `TabBar` ni segunda tarjeta.
- Se compara **siempre de dos en dos**: A (base) y B (candidata). Los huecos están encima de la tabla y el siguiente libre se resalta con el acento; cada fila lleva un círculo punteado con la letra que recibiría (`A` o `B`) y se rellena al elegirla. Clic en una fila elegida la libera; con A y B puestas, una tercera sustituye a B. No hay checkboxes: el límite se lee en la propia interfaz.
- La comparación aparece sola al tener A y B (sin botón intermedio); antes se ven cuatro huecos vacíos con «Pick A and B above…». Con una sola fila esa fila es A, no se puede elegir y se explica cómo conseguir un segundo valor (`breakdown-guide`).
- **Color por rol**: A usa el acento (`--mt-accent*`, turquesa) y B el terracota de la marca (`--mt-highlight*`); no hay tokens propios, solo los de la paleta Mediterráneo (ADR-048). El color recorre todo el flujo: hueco, círculo de la fila, fila resaltada con barra lateral, insignia junto al nombre y cifras de la comparación (`from` en A, `to` en B). La letra sigue ahí, así que el color nunca es el único indicador. Se evita rojo/verde, que ya significan peor/mejor en los deltas.
- Patrón reutilizable para cualquier comparación por pares: huecos con rol (Baseline / Candidate) + pista de qué falta + estado vacío explicado.

## 10. Detalle de traza: pasos de la respuesta y traza técnica

- **Pestaña Conversation**: entre el último mensaje del usuario y la respuesta, `ConversationSteps` pinta una línea de pasos («How the answer was built»). Se entra por el slot `steps` de `ConversationThread`, que lo coloca justo tras el último mensaje del usuario; con pasos, las líneas «Used …» y los bloques «Data retrieved» que traen los mensajes se omiten porque los pasos ya lo cuentan. Sin pasos (traza sin guardarraíles, retriever, tools ni LLM) la pestaña queda como antes.
- Los pasos salen de `domain/conversation-steps.ts` (función pura sobre el árbol de spans, sin endpoint ni almacén nuevos): guardarraíles agrupados en un paso, `retriever` con los fragmentos de `memtrace.retriever.chunks` (fuente, puntuación; «Low match» por debajo de 0,5), `tool` con argumentos y resultado como filas y la última llamada al modelo (si no pidió otra tool) como respuesta. Una tool que contiene un `retriever` se muestra una sola vez, como búsqueda. Qué fragmentos usó la respuesta **no** se muestra: la traza no lo registra.
- Retriever, tool y cualquier paso fallido empiezan abiertos; el resto, plegados. El enlace «Open in technical trace →» solo aparece con `trace:read_technical` y abre la pestaña técnica con `?span=`.
- **Pestaña Technical trace**: `TraceOverviewBar` (franja resumen + chips de filtro por tipo + «Group guardrails») encima de la cascada. El resumen y los filtros son funciones puras de `domain/trace-summary.ts`. Con un filtro activo la cascada pasa a ser una lista plana de los spans que lo cumplen (`buildRows(..., filter)`); «Group guardrails» pliega por defecto los spans cuyos hijos son todos comprobaciones `guardrail.*`, salvo que alguna falle o el span seleccionado esté dentro. El span más lento (LLM, tool o retriever) lleva la etiqueta «Slowest».
- **Argumentos y resultados como tabla**: en `IoPanel`, un bloque estructurado de tool (objeto JSON) se pinta con `StructuredData` (filas clave/valor, un nivel de objetos anidados con claves con puntos y las listas de objetos como tabla de hasta 5 filas visibles). El JSON crudo sigue en la vista «JSON» del panel.
