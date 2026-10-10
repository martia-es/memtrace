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

- La barra lateral tiene cinco secciones y una sección puede tener hijos, cada uno con su propia URL. Se expande el grupo de la página actual. El árbol vive en `NAV` (`MainLayout.vue`) y cada ruta marca su entrada con `meta.section`.
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
| `Menu`, `MenuItem`, `Modal`, `Spinner`, `LoadingState` | Popover, diálogo (con slot `footer`) y estados de carga. |

Un `<button>` crudo solo se admite en las interioridades de estos componentes y en piezas cuyo diseño es el botón entero (disparadores de popover, filas desplegables, cabeceras ordenables, respuestas con atajo de teclado, botones OAuth). La lista, con su motivo, está en `Widgets.test.ts`.

## 4. Gráficas personalizadas

- El modelo guardado (`CustomMetricDefinition`) no cambia: guarda `step_type`, claves de atributo y métricas cerradas. Por eso renombrar nada rompe gráficas ni informes ya guardados.
- La presentación pasa por un único módulo puro, `domain/custom-chart-vocabulary.ts`: nombre editado → diccionario integrado → identificador «humanizado».
- «Empieza por una pregunta»: plantillas que son `CustomMetricDefinition` normales, ofrecidas solo si existen los pasos necesarios en el rango. Flujo en tres pasos (qué medir, cómo verlo, guardar) con vista previa en vivo. Los atributos técnicos (`memtrace.*`, `otel.*`, `gen_ai.usage.*`) quedan tras «Show technical details».
- El catálogo editable ([ADR-078](adrs/ui/adr-078-editable-chart-catalog.md)) es la misma tabla (`ChartCatalogTable`) en tres sitios: modal «Customize names», renombrado en el sitio sobre cada chip de paso y la página **Overview › Data catalog**. Editar exige `catalog:manage`; verlo, `experiment:read`.

## 5. Prompts: lista y detalle

- La lista es una tabla (`DataTable`): `Prompt | Latest | DEV | PRE | PRO | Updated`. Cada entorno es un chip con la versión; en `pro`, si va por detrás, el chip se resalta y dice «N behind». Un solo aviso arriba («N prompts run behind…», con «Show them») y solo si hay algo que atender. Todo se deriva de lo que la lista ya devuelve (`latestVersion`, `tags`).
- Prompts y fragmentos son una sola pantalla con un `SegmentedControl` (`?kind=fragments`) y el estado de release un filtro (`?status=behind`), según la regla de «filtros en vez de submenú». «Show archived» vive en el menú ⋯.
- El detalle de un prompt abre con una franja de entornos (una tarjeta por entorno con su versión, estado y la acción «Promote vN» / «Request approval») y pestañas por tarea con `TabBar`: Overview, Versions, Test, Releases, Used by. Una pestaña puede agrupar dos vistas con un `SegmentedControl` en la barra de la vista (Versions: List | Compare; Test: Try it | Fix a failure; Releases: Tags & policy | Approvals). No hay panel lateral: variables e inclusiones van bajo el texto.
- La lista de versiones (buscador, fijadas por tag, agrupadas por mes) es `PromptVersionList`, y se usa en el desplegable del texto y en la pestaña Versions. Las reglas de «detrás» y de agrupación son funciones puras en `domain/prompt-release.ts`; `EnvFlag` pinta la etiqueta de entorno.
- Un mensaje de versión vacío no se pinta («No message» no aporta nada).
- Limitación: la tabla asume los tres entornos habituales; con otros nombres las etiquetas extra salen junto al nombre del prompt.

## 6. Asistente embebido

Tres modos de visualización: `bubble` (ventana flotante), `dock` (panel lateral que empuja el contenido) y `fullscreen` (ruta `/assistant` en pestaña nueva, abierta dentro del gesto de clic para que el navegador no la bloquee). `resolveMode(theme, userMode)` elige la preferencia personal si la organización la permite, si no el modo por defecto de la organización y, si no, la burbuja. La preferencia personal vive en `localStorage`, no en el perfil.

## Cómo añadir cosas

- Una sección nueva = un hijo en `NAV` + una ruta con su `meta.section`.
- Un control nuevo = primero buscar si ya existe en la tabla de componentes; si no, crearlo allí y añadirlo a esta tabla.
- Un color nuevo = un token `--mt-*` con valor claro y oscuro; nunca un hex dentro de un componente.
