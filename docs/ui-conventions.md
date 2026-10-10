# Convenciones de UI del dashboard

Reglas vigentes del dashboard (`dashboard/`). Sustituye a los ADR de UI 017–019, 046, 057–059, 063, 071 (release board de prompts), 079 y 080–083, que estaban retirados por ser convenciones y no decisiones de arquitectura (ver [docs/adrs/README.md](adrs/README.md)). El sistema de diseño de base sigue en [ADR-048](adrs/ui/adr-048-mediterranean-design-system-and-simplified-navigation.md) y la identidad de marca en [brand.md](brand.md).

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

- La barra lateral tiene cinco secciones y una sección puede tener hijos, cada uno con su propia URL. Se expande el grupo de la página actual. El árbol vive en `NAV` (`MainLayout.vue`) y cada ruta marca su entrada con `meta.section`.
- **No hay pestañas dentro de las páginas** para navegar por la app. Solo las usan las páginas de detalle de un objeto (dataset: Items / Versions / Runs, asistente, admin), porque son secciones de una misma cosa.
- Toda vista es enlazable y sobrevive a un reload; el rango y los filtros viajan en la query del enlace.
- Barra superior global (52 px) con dos huecos, izquierdo (migas / título) y derecho (filtros y acciones). Las páginas no pintan cabecera: usan `PageHeader` / `TopbarSlot`, que teletransporta al hueco (`useTopbar`). Sin topbar (tests), el contenido se pinta en su sitio. `FilterBar` es el control de rango (presets + «Custom»).
- Admin es jerárquico, un nivel por URL: `/admin` (organizaciones) → `/admin/organizations/:id` (Experiments, Members, Appearance) → `/admin/experiments/:id` (Connect, API keys, Score configs, Members). Las acciones se muestran o se ocultan según `myRole`; el backend es quien impone el permiso.

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
| `Menu`, `MenuItem`, `Modal`, `Spinner`, `LoadingState` | Popover, diálogo (con slot `footer`) y estados de carga. |

Un `<button>` crudo solo se admite en las interioridades de estos componentes y en piezas cuyo diseño es el botón entero (disparadores de popover, filas desplegables, cabeceras ordenables, respuestas con atajo de teclado, botones OAuth). La lista, con su motivo, está en `Widgets.test.ts`.

## 4. Gráficas personalizadas

- El modelo guardado (`CustomMetricDefinition`) no cambia: guarda `step_type`, claves de atributo y métricas cerradas. Por eso renombrar nada rompe gráficas ni informes ya guardados.
- La presentación pasa por un único módulo puro, `domain/custom-chart-vocabulary.ts`: nombre editado → diccionario integrado → identificador «humanizado».
- «Empieza por una pregunta»: plantillas que son `CustomMetricDefinition` normales, ofrecidas solo si existen los pasos necesarios en el rango. Flujo en tres pasos (qué medir, cómo verlo, guardar) con vista previa en vivo. Los atributos técnicos (`memtrace.*`, `otel.*`, `gen_ai.usage.*`) quedan tras «Show technical details».
- El catálogo editable ([ADR-078](adrs/ui/adr-078-editable-chart-catalog.md)) es la misma tabla (`ChartCatalogTable`) en tres sitios: modal «Customize names», renombrado en el sitio sobre cada chip de paso y la página **Overview › Data catalog**. Editar exige `catalog:manage`; verlo, `experiment:read`.

## 5. Prompts: release board

- La lista abre con un tablero de lanzamiento (prompts fijados en `dev`, `pre`, `pro` y cuántos van por detrás en `pro`), chips de estado (*Behind in PRO*, *In sync*, *Not released*) y una línea con las últimas 9 versiones. Todo se deriva de lo que la lista ya devuelve (`latestVersion`, `tags`).
- En la página de un prompt, las versiones forman un raíl vertical con búsqueda, una sección «Pinned by tags» siempre arriba y el resto agrupado por mes. Las reglas de «detrás», cobertura por entorno y agrupación son funciones puras en `domain/prompt-release.ts`. `EnvFlag` pinta la etiqueta de entorno.
- Limitación: el tablero asume los tres entornos habituales; con otros nombres hace falta que la lista devuelva las claves de entorno.

## 6. Asistente embebido

Tres modos de visualización: `bubble` (ventana flotante), `dock` (panel lateral que empuja el contenido) y `fullscreen` (ruta `/assistant` en pestaña nueva, abierta dentro del gesto de clic para que el navegador no la bloquee). `resolveMode(theme, userMode)` elige la preferencia personal si la organización la permite, si no el modo por defecto de la organización y, si no, la burbuja. La preferencia personal vive en `localStorage`, no en el perfil.

## Cómo añadir cosas

- Una sección nueva = un hijo en `NAV` + una ruta con su `meta.section`.
- Un control nuevo = primero buscar si ya existe en la tabla de componentes; si no, crearlo allí y añadirlo a esta tabla.
- Un color nuevo = un token `--mt-*` con valor claro y oscuro; nunca un hex dentro de un componente.
