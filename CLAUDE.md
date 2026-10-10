

Por cada código que vayas a implementar tienes que:

1. Leer docs/roadmap.md donde se define el roadmap completo de este proyecto. No debes perder el foco ni tomar decisiones que no sean escalables con la visión final de este proyecto.
2. Actualizar docs-site/ solo con la información que sea relevante para un usuario de esta libreria + herramienta.

Además:
- Solo crea un ADR para decisiones de arquitectura difíciles de revertir (un almacén nuevo, un protocolo, un modelo de datos, una frontera de seguridad, un contrato público) que afecten a más de un componente y tengan alternativas reales. Lee antes docs/adrs/README.md: ahí están los criterios, el índice y la numeración. Si ya existe un ADR del mismo tema, amplíalo en vez de crear otro. El ADR va en docs/adrs/<tema>/, con el título en inglés, por ejemplo: docs/adrs/sdk/adr-001-use-fastapi.md, y no debe contener más de 500 líneas. Los temas son: infra, storage, sdk, api, identity, governance, observability, evaluation, datasets, prompts, pricing, ui. Actualiza la tabla de docs/adrs/README.md.
- No es un ADR: una pantalla nueva, un endpoint que sigue un patrón existente, un componente o una convención de UI (va en docs/ui-conventions.md), ni lo que queda pendiente (va en docs/backlog.md). Consulta docs/README.md para saber dónde va cada cosa.

- El Readme.md debe quedarse limpio, debe ser una guia básica para entender la estructura de este proyecto y los comandos básicos para levantarlo. Actualizalo solo cuando sea necesario.

Utiliza los worktrees para cada funcionalidad que tengas que hacer, de esta forma no habrá choque ni conflicto con lo que otro asistente de IA pueda estar haciendo. En cuanto termines, sube tus cambios a una rama y pídeme que valide, dándome siempre un plan de pruebas. Cuando yo te dé el ok, entonces fusionamos a main. Usa siempre git conventions. Si es un cambio sencillo que solo implica un cambio en la UI, entonces fusionalo directamente.

Cualquier cambio importante en la UI debes darme una propuesta antes aquí: https://claude.ai/artifact/6gwybELrAPkFbnt9C1XfUD
