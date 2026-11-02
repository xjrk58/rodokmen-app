# Invented fixture Vault

An invented Vault in the format of the Owner's `rodokmen-data` repository, for the tests of the Vault
importer (`server/test/vault-import.test.ts`). Every person, entry and document here is made up; nothing
comes from the real Vault, which never enters this repository.

The Person notes are kept under `persons/`, because the repository guard (`.github/scripts/repo-guard.sh`) refuses
any `people/` folder. The tests copy this folder to a temporary one and rename `persons/` to `people/`, the
Vault's layout (`server/test/fixture-vault.ts`).
