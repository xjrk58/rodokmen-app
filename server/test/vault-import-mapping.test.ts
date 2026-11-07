import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mapVault, type MapOptions } from '../src/vault-import/mapper.js';
import type { Plan } from '../src/vault-import/plan.js';
import { readVault } from '../src/vault-import/reader.js';
import { fixtureVault } from './fixture-vault.js';

/**
 * What the importer plans for the invented fixture Vault, without a server: the mapping rules of
 * the follow-ups of the Owner's import. vault-import.test.ts imports the same Vault into a Tree.
 */
const OPTIONS: MapOptions = {
  municipalities: [{ code: '572128', name: 'Vrbice', district: 'Jičín', lat: 50.38, lon: 15.39 }],
  givenBy: 'Owner Example',
  roots: [],
  today: new Date('2026-11-02T12:00:00Z'),
};

describe('mapping the fixture Vault', () => {
  let vault: Awaited<ReturnType<typeof fixtureVault>>;
  const plan = async (): Promise<Plan> => mapVault(await readVault(vault.path), OPTIONS);
  const ops = (p: Plan) => p.proposals.flatMap((x) => x.ops);
  const edit = async (path: string, from: string, to: string) => {
    const file = join(vault.path, path);
    const text = await readFile(file, 'utf8');
    expect(text).toContain(from);
    await writeFile(file, text.replace(from, to));
  };

  beforeEach(async () => {
    vault = await fixtureVault();
  });
  afterEach(async () => {
    await vault.remove();
  });

  describe('a marriage both spouses record without a Source note (#149)', () => {
    const marriages = (p: Plan) => ops(p).filter((o) => o.op.op === 'createEvent' && o.op.type === 'marriage' && o.key.includes(':vault:'));

    it('is one Event, keyed by the note that comes first, and the second note attaches its Citation to it', async () => {
      const p = await plan();
      const key = 'event:marriage:person:marie-svobodova-1775+person:tomas-novak-1770:vault:marie-svobodova-1775:0';
      expect(marriages(p).map((o) => o.key)).toEqual([key]);
      const tomas = p.proposals.find((x) => x.path === 'people/tomas-novak-1770.md')!;
      expect(tomas.ops.map((o) => o.key)).toContain(`cite:${key}:vault-citation:people/tomas-novak-1770.md`);
      expect(p.mergedMarriages).toEqual([
        {
          key,
          earlierKey: 'event:marriage:person:marie-svobodova-1775+person:tomas-novak-1770:vault:tomas-novak-1770:0',
          paths: ['people/marie-svobodova-1775.md', 'people/tomas-novak-1770.md'],
        },
      ]);
      expect(p.issues.filter((i) => i.kind === 'marriageDiffers')).toEqual([]);
    });

    it('with another date in one note: two Events, and the dry run lists them once', async () => {
      await edit('people/tomas-novak-1770.md', 'date: 1799-11-20', 'date: 1799-11-27');
      const p = await plan();
      expect(marriages(p).map((o) => o.key.split(':vault:')[1])).toEqual(['marie-svobodova-1775:0', 'tomas-novak-1770:0']);
      expect(p.mergedMarriages).toEqual([]);
      expect(p.issues.filter((i) => i.kind === 'marriageDiffers')).toEqual([
        {
          kind: 'marriageDiffers',
          path: 'people/marie-svobodova-1775.md',
          detail: 'marriages.0: people/tomas-novak-1770.md gives another date or Place; two marriage Events',
        },
      ]);
    });

    it('recorded by one spouse only: an Event of that note, as before', async () => {
      await edit('people/tomas-novak-1770.md', "marriages:\n  - spouse: '[[marie-svobodova-1775]]'\n    date: 1799-11-20\n    place: '[[vrbice]]'\n", '');
      const p = await plan();
      expect(marriages(p).map((o) => o.key.split(':vault:')[1])).toEqual(['marie-svobodova-1775:0']);
      expect(p.mergedMarriages).toEqual([]);
    });
  });
});
