# MemTrace — Brand Guidelines (v1.0)

Documento de marca: define qué transmite MemTrace y cómo se traduce al diseño. La implementación en el dashboard está decidida en [ADR-048](adrs/ui/adr-048-mediterranean-design-system-and-simplified-navigation.md).

## 1. Esencia

**Qué es:** plataforma open source, enterprise-ready y pensada para seguridad, que centraliza observabilidad, evaluaciones, calidad, gobierno e informes de asistentes de IA.

**Por qué existe:** las herramientas open source actuales se quedan cortas frente a las de pago (LangSmith). MemTrace aspira a ser igual de potente y cuidada, y además personalizable.

**Nombre:** *MemTrace* = **Mem**oria + **Trace**abilidad. Recordar y poder seguir el rastro de lo que hacen tus agentes.

**Promesa:** *Entiendes lo que pasa en tus asistentes, con tranquilidad y sin esfuerzo.*

**Sensaciones a transmitir:** control · calma · confianza · simpleza · facilidad.
**Sensaciones a evitar:** complejidad · exceso de navegación · sensación de mucho trabajo · frialdad técnica.

## 2. Personalidad

Si MemTrace fuera una persona: alguien **calmado, analítico y resolutivo**, que transmite paz y con quien sabes que cualquier problema tendrá solución. Algo **cercano**, pero sobrio.

| Eje | Posición |
|---|---|
| Serio ↔ cercano | Cercano |
| Minimalista ↔ expresivo | Minimalista |
| Denso ↔ aireado | Aireado |
| Sobrio ↔ con humor | Sobrio |
| Premium ↔ accesible | Premium, sin ser intimidante |

## 3. Audiencia

Una sola herramienta para dos perfiles:

- **Técnico:** uso intensivo, todo el día; necesita profundidad y detalle.
- **Negocio:** 2-3 veces al día; necesita entender qué hacen los asistentes sin conocimientos técnicos.

**Principio de diseño derivado:** *simple por defecto, profundo bajo demanda.* La primera capa se entiende sin formación; el detalle técnico aparece al pedirlo (progressive disclosure), nunca de golpe.

## 4. Posicionamiento

- **Referencia de calidad UI/UX:** LangSmith (claridad, innovación, cuidado).
- **Referencia de estilo general:** Notion (limpio, aireado, amable).
- **Lo que no queremos ser:** MLflow (descuidado); Langfuse se queda en un punto intermedio.
- **Diferencial:** open source con nivel de producto de pago, todo centralizado, personalizable y con enfoque enterprise/seguridad.

## 5. Principios visuales

1. **Denso, nunca saturado:** filas de 46–50 px, separadores de 1 px y cero sombras; el aire viene de la estructura, no del relleno.
2. **Resumen primero, detalle bajo demanda:** la primera capa se entiende sin formación y lo técnico está a un clic.
3. **Una acción principal por vista:** menos menús y menos niveles de navegación (5 secciones).
4. **El color significa algo:** turquesa = acción y selección; terracota = resaltado; verde, ámbar y rojo solo para estado.
5. **Esquinas casi rectas:** 4 px en chips y badges, 6 px en botones e inputs, 8 px en tarjetas. Sin píldoras.
6. **Claro por defecto**, con modo oscuro diseñado a propósito (mismos tokens, valores propios).

## 6. Color — "Mediterráneo"

Inspirada en el sur: el turquesa de las calas de Cabo de Gata y la terracota al sol.

| Rol | Claro | Oscuro |
|---|---|---|
| Acción (`--mt-accent`) | `#00857f` | `#2bc4bd` |
| Marca / gráficos (`--mt-brand`) | `#00b3ad` | `#2bc4bd` |
| Resaltado (`--mt-highlight`) | `#ff6b4a` | `#ff8a6b` |
| Fondo / superficie | `#f2faf9` / `#ffffff` | `#081716` / `#0e2221` |
| Texto / atenuado | `#0a2321` / `#4d6a67` | `#e6f4f2` / `#8fb0ac` |
| Borde | `#d6e9e7` | `#1d3c3a` |
| Éxito · aviso · error | `#16a34a` · `#f59e0b` · `#e11d48` | `#4ade80` · `#fbbf24` · `#ff6b88` |

Series de gráficos: turquesa `#00b3ad`, terracota `#ff6b4a`, mar hondo `#0a5c8f`, sol `#ffb820`, arena `#c9a27a`, pizarra `#64748b`.

Reglas: el relleno de un botón con texto blanco cumple contraste AA (4,5:1); el turquesa de marca claro se usa solo en gráficos y elementos decorativos. Cada organización puede sustituir únicamente el color de acción ([ADR-019](ui-conventions.md)). Los tokens viven en `dashboard/src/styles/app.css`.

## 7. Tipografía

- **Plus Jakarta Sans** (13 px base, títulos 800) para todo lo que se lee: redondeada y cercana, pero firme.
- **JetBrains Mono** para ids, marcas de tiempo, duraciones y toda columna numérica, de modo que las cifras se alineen.
- Escala: título de página 20/800, sección 14–15/800, cuerpo 13/500, celda de tabla 12,5/500, etiqueta 11/700 en mayúsculas.

## 8. Tono de voz

**Directo y tranquilizador.**

- Frases cortas, sin jerga innecesaria; explicar en lenguaje de negocio y ofrecer el término técnico aparte.
- Los errores explican qué pasó y qué hacer, sin alarmismo.
- Los estados vacíos orientan hacia el siguiente paso.

| En vez de | Mejor |
|---|---|
| "Error 500: query failed" | "No hemos podido cargar las trazas. Inténtalo de nuevo; tus datos están a salvo." |
| "No data" | "Aún no hay trazas. Conecta tu primer agente en 2 minutos." |

Ejemplos reales de la interfaz: "Your assistant is healthy", "Nothing needs your attention in this range", "You are all caught up".

## 9. Identidad

- **Logo:** tres barras redondeadas que recuerdan a la cascada de una traza: turquesa, terracota y turquesa suave (en `MainLayout.vue` y en la pantalla de login). Favicon en `dashboard/public/favicon.svg` y versión de una sola tinta en `dashboard/public/logo-mono.svg`.
- **Modelo:** open source; la marca debe sentirse abierta y de confianza, además de enterprise.

## 10. Próximos pasos

1. Valoraciones de usuarios finales como señal de calidad en "Needs attention" (hoy se usan las etiquetas humanas de Review, [ADR-049](adrs/README.md#retired-adrs)).
2. Versión del logo en una sola tinta para documentación e impresión (`dashboard/public/logo-mono.svg`) y revisión del favicon sobre fondos claros.
