

Por cada código que vayas a implementar tienes que:

1. Leer docs/roadmap.md donde se define el roadmap completo de este proyecto. No debes perder el foco ni tomar decisiones que no sean escalables con la visión final de este proyecto.
2. Actualizar docs-site/ solo con la información que sea relevante para un usuario de esta libreria + herramienta.


Además:
- Cada vez que hagas una funcionalidad que requiera tomar / modificar una decisión de diseño, debes crear un ADR en docs/adrs, con el titulo en ingles, por ejemplo: docs/adrs/sdk/adr-001-use-fastapi.md. Los ADRs están organizados en subcarpetas por temática (infra, storage, sdk, api, identity, ui, observability, evaluation, datasets, pricing) — coloca cada ADR nuevo en la subcarpeta que corresponda, o crea una nueva si ninguna encaja. Este ADR debe ser sencillo y no debe contener más de 500 líneas. No debes hacer un ADR por cada nuevo desarrollo, solo por decisiones que impliquen cambios de arquitectura importantes.

- El Readme.md debe quedarse limpio, debe ser una guia básica para entender la estructura de este proyecto y los comandos básicos para levantarlo. Actualizalo solo cuando sea necesario.


Utiliza los worktrees para cada funcionalidad que tengas que hacer, de esta forma no habrá choque ni conflicto con lo que otro asistente de IA pueda estar haciendo. En cuanto termines, sube tus cambios a una rama y pídeme que valide, dándome siempre un plan de pruebas. Cuando yo te dé el ok, entonces fusionamos a main. Usa siempre git conventions.
