"""Taxonomía de causas de comportamiento de un agente (Q10, propuesta para un solo agente).

Los errores de infraestructura (cuota, timeout, credenciales...) no entran aquí: los cubre el catálogo de ADR-066
(`api/src/domain/error-categories.ts`). Esto es para fallos del propio agente, que no lanzan excepción.
Adaptada de MAST (14 modos) y de las categorías de TRAIL; se quitan los modos que solo existen entre varios agentes.

Cuando una razón encaja en varias, gana la primera de `PRIORITY` (de más específica a más general).
"""

CAUSES = {
    "tool_misuse": "Elige mal la herramienta, la llama con argumentos incorrectos o en mal orden, o interpreta mal su salida.",
    "bad_code": "Escribe código o consultas que son incorrectos o no se ejecutan (fallos de lógica, imports, esquema).",
    "bad_retrieval": "No obtiene la información necesaria: búsqueda mal planteada, fuente irrelevante, no encuentra o se rinde.",
    "fabrication": "Inventa datos o da por cierto algo sin comprobarlo: valores de relleno, ficheros o hechos supuestos.",
    "context_loss": "Olvida o ignora algo que ya estaba en la conversación (historial, restricción, aportación de otro agente).",
    "instruction_violation": "Incumple una instrucción explícita: política, rol, restricción de formato o de alcance.",
    "goal_drift": "Se desvía del objetivo o planifica mal: repite pasos, entra en bucle, no replanifica tras un fallo.",
    "bad_termination": "Termina mal: responde sin evidencia suficiente, para antes de tiempo o no verifica el resultado.",
    "wrong_reasoning": "El razonamiento o la respuesta es incorrecto (alucinación, cálculo, conclusión sin base) sin encajar en lo anterior.",
    "unclear": "La razón es demasiado vaga para clasificarla.",
}
PRIORITY = list(CAUSES)  # el orden del diccionario es la prioridad

# Equivalencias aproximadas con MAST, para contrastar con sus etiquetas
MAST = {
    "tool_misuse": ["2.6"],
    "bad_code": [],
    "bad_retrieval": [],
    "fabrication": "Inventa datos o da por cierto algo sin comprobarlo: valores de relleno, ficheros o hechos supuestos.",
    "fabrication": [],
    "context_loss": ["1.4", "2.1", "2.5"],
    "instruction_violation": ["1.1", "1.2"],
    "goal_drift": ["1.3", "2.3"],
    "bad_termination": ["1.5", "3.1", "3.2", "3.3"],
    "wrong_reasoning": ["2.6"],
}
