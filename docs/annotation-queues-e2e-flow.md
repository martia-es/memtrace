# Flujo end-to-end de las colas de revisión

Written for: product y equipo técnico que van a rediseñar la interfaz de colas de anotación.

Estado: propuesta para revisar. Lo que ya existe está marcado como **hoy**; lo nuevo, como **propuesto**.

## Roles

| Rol | Qué hace |
|---|---|
| Técnico (admin o member con acceso a datasets) | Prepara el juez y la rúbrica, envía items a la cola, promociona a dataset, lee métricas técnicas. |
| Negocio (quien sabe qué debe responder el agente) | Valora respuestas en la cola y mira el resultado de su revisión frente al juez. |

Decisión: **solo el técnico promociona a dataset.** Negocio no ve ese botón.

## Pasos

### 1. Preparar el juez y la rúbrica (técnico)

- **Hoy:** los evaluadores LLM-as-judge producen puntuaciones en un run. La rúbrica humana de la cola debe tener **el mismo nombre** que el evaluador para que se crucen. Esta regla solo aparece como texto de ayuda cuando no hay etiquetas.
- **Propuesto:** al crear la cola desde un run, la rúbrica se rellena con los evaluadores del run, con su nombre y tipo, y se avisa si algún evaluador no tiene rúbrica humana equivalente.

### 2. Enviar items a la cola (técnico)

- **Hoy:** desde la página del run, "Send items to a review queue", con muestreo aleatorio por defecto. Desde una traza, "Add to queue" con filtros.
- **Propuesto:** sin cambios de comportamiento. Mostrar en la cola cómo se eligieron los items (aleatorio, filtro, run) y cuántos hay en total.

### 3. Revisar (negocio)

- **Hoy:** la pantalla muestra primero el árbol de spans y la rúbrica queda pequeña a la derecha.
- **Propuesto:** la respuesta del agente y la pregunta del usuario son lo primero, en texto legible. La rúbrica es la columna principal, con controles grandes y un contador de criterios. El árbol de spans queda en "Ver traza técnica", colapsado. Atajos de teclado para valorar y avanzar. Las etiquetas de otros revisores solo se ven después de enviar.
- Cada item se reserva 15 minutos (lease). Si la persona cierra la pestaña, el item vuelve al reparto. **Hoy, ya implementado.**

### 4. Ver el resultado de la cola (negocio y técnico)

- **Hoy:** el progreso y el reparto por revisor están en el modal "Details" de la cola. La concordancia juez-humano está en la página del run, con el título "Agreement with human labels", debajo de los KPIs.
- **Propuesto:** una pestaña **"Resultado"** dentro de la cola, visible a negocio:
  - progreso (completados, pendientes, saltados);
  - concordancia con el juez, en lenguaje llano ("Coincides con el juez en el 85 % de los items revisados");
  - lista de desacuerdos, con enlace a cada item;
  - aviso cuando la muestra es pequeña o no aleatoria.
- Las métricas estadísticas completas (kappa, matriz de confusión, MAE, Pearson, Spearman) se quedan en la vista técnica.

### 5. Decidir (negocio, con apoyo técnico)

- **Propuesto:** la pestaña "Resultado" muestra una recomendación según la concordancia:
  - alta: el juez es fiable para este evaluador;
  - media: revisar la rúbrica del juez o los desacuerdos;
  - baja: el juez no sigue la opinión humana, no usar su puntuación.
- La decisión la registra negocio como nota en la cola. No cambia nada automáticamente.

### 6. Promocionar a dataset (técnico)

- **Hoy:** "Promote to dataset" en la cola, que envía las trazas revisadas al dataset elegido, con la etiqueta categórica como resultado esperado. Traza con desacuerdo o ya presente se omiten y se cuentan.
- **Propuesto:** el botón solo aparece para roles técnicos. Negocio ve el estado ("Listo para dataset: 40 items") sin la acción.

### 7. Cerrar el ciclo (técnico)

- Ejecutar un experimento offline contra el dataset nuevo y compararlo con el anterior. **Hoy, ya existe.**

## Lo que falta para que el flujo sea completo

1. Un estado de cola visible: "en revisión", "completada", "lista para dataset".
2. La concordancia y los desacuerdos accesibles desde la cola, no solo desde el run.
3. El nombre compartido entre juez y rúbrica hecho explícito en la creación de la cola.
4. El botón de promoción restringido a técnicos.

## Preguntas abiertas

- ¿La recomendación de la pestaña "Resultado" usa los mismos umbrales de kappa que la documentación (0.6 sólido, 0.4 alarma)? Para datos muy sesgados, la exactitud sola engaña.
- ¿La nota de decisión de negocio se guarda como anotación o como texto libre de la cola?
- ¿Qué roles técnicos pueden promocionar? ¿Solo admin o también members?
