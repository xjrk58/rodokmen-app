# How to regenerate the C4 diagrams

This guide shows you how to update the architecture diagrams in [`docs/architecture/`](../architecture/README.md) after changing what they show. Every diagram comes from one Structurizr model, `docs/architecture/workspace.dsl`; the `architecture` workflow fails when the committed diagrams differ from what the model generates.

You need Docker. The script pulls the pinned Structurizr and PlantUML images on its first run.

1. Change the model in `docs/architecture/workspace.dsl`. Tag each new element and relationship with its status (`Built`, `In progress` or `Planned`) and give it the `openspec`, `adr` and `code` properties the others have.
2. Validate the model and regenerate every diagram:

   ```sh
   docs/architecture/generate.sh
   ```

   It prints:

   ```text
   Validating workspace.dsl
   Exporting Mermaid and C4-PlantUML
   Rendering SVG with PlantUML
   Done: 16 diagrams in docs/architecture/generated/
   ```

   If the model is invalid, it prints Structurizr's errors and exits 1, and changes nothing.

3. To look at the diagrams as PNGs, render them outside the repo (the repo guard refuses raster images outside `app/`):

   ```sh
   PNG_DIR=/tmp/c4-png docs/architecture/generate.sh
   ```

4. If you added or renamed a view, update the list of views in `docs/architecture/README.md`.
5. Commit `docs/architecture/generated/` together with `workspace.dsl`.

Don't use the `structurizr/cli` image: its last version only prints a deprecation notice and validates nothing.
