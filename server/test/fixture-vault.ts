import { cp, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The invented fixture Vault (test/fixtures/vault), laid out as the Vault is, in a temporary
 * folder. The repository keeps its Person notes under persons/: the repo guard
 * (.github/scripts/repo-guard.sh) refuses any people/ folder, the layout of an Export of the Tree,
 * so that a real Vault or Export copied into the repository is caught. The copy puts them under
 * people/, where the importer reads them.
 */
export const FIXTURE_VAULT = new URL('./fixtures/vault/', import.meta.url).pathname;

export async function fixtureVault(): Promise<{ path: string; remove: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'rodokmen-vault-'));
  await cp(FIXTURE_VAULT, path, { recursive: true });
  await rename(join(path, 'persons'), join(path, 'people'));
  return { path, remove: () => rm(path, { recursive: true, force: true }) };
}
