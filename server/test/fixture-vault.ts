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

/**
 * The Citations of the fixture baptism that cites its register note directly instead of an entry
 * (#133), as [Source title, page, confidence] sorted: the register's at the Person's confidence,
 * and the Vault provenance Citation with the note's path.
 */
export const REGISTER_CITED_BAPTISM = [
  ['N Vrbice, Kamenná Lhota 1784–1820', null, 'normal'],
  ['Vault (rodokmen-data)', 'people/viktorie-novakova-1804.md', 'low'],
];

/** An invented session log note of about 12,000 characters, with line breaks: longer than a lead's reason before #136. */
export const longLog = (topic: string): string =>
  `---\ntype: log\ndate: 2026-10-25\ntopic: ${topic}\nagent: Invented agent\n---\n\n` +
  Array.from({ length: 125 }, (_, i) => `Line ${i + 1} of an invented session log, long enough to need more than four thousand characters.`).join('\n') +
  '\n';
