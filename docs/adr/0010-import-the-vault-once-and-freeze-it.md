# Import the Vault once, freeze it, and Export elsewhere

Before the Tree existed, the Owner and Agents built a Vault of Markdown notes in the private `rodokmen-data` repo: about 4,100 Persons, register entries and their scans. A deterministic importer brings the Vault into the Tree once, as Proposals the Owner reviews (ADR 0001). After import day the Vault is a read-only archive, and Agents contribute through the API instead. Its history holds scans and Living people, so nothing may overwrite it. The nightly Export (ADR 0008) therefore goes to a new private repo, `rodokmen-export`, not to `rodokmen-data`.

## Considered Options

- **Keep the Vault as a second place to edit and sync both ways**: rejected, because two sources of truth would need merging, which review exists to avoid.
- **Let an AI agent re-enter the Vault by reading it**: rejected for the structured fields. A parser is repeatable and invents nothing; Agents only pick up what exists in prose alone.
- **Export into `rodokmen-data` as ADR 0008 first said**: rejected, because the Export would overwrite the archive.
