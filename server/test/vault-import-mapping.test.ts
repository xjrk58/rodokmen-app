import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mapVault, type MapOptions } from '../src/vault-import/mapper.js';
import type { Plan } from '../src/vault-import/plan.js';
import { readVault } from '../src/vault-import/reader.js';
import { fixtureVault, longLog } from './fixture-vault.js';

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

  it('presumed death: a son’s baptism or a marriage bounds the birth; married in 1925 or no dates and no relatives, left alone (#132)', async () => {
    const person = (id: string, more: string) =>
      writeFile(join(vault.path, `people/${id}.md`), `---\ntype: person\nname:\n  given: Invented\n  surname: ${id}\nliving: false\n${more}---\n`);
    await person('anna-novakova-1900', "marriages:\n  - date: 1925-06-01\n    place: '[[vrbice]]'\n");
    await person('nikdo-1800', '');
    const p = await plan();
    const presumed = Object.fromEntries(p.issues.filter((i) => i.kind === 'presumedDeath').map((i) => [i.path, i.detail]));
    expect(Object.keys(presumed)).toEqual(['people/ludmila-vesela-1805.md', 'people/marie-svobodova-1775.md', 'people/tomas-novak-1770.md']);
    expect(presumed['people/ludmila-vesela-1805.md']).toBe(
      'Died, date unknown: born by 1813-02-01 at the latest (married 1825-02-01, at least 12 years old), more than 125 years before 2026-11-02.',
    );
    // The new notes are left alone, and the dry run lists them as Living in the Tree while the Vault says not.
    expect(p.issues).toContainEqual({ kind: 'livingDiffers', path: 'people/anna-novakova-1900.md', detail: 'Vault: not Living; the Tree: Living' });
    expect(p.issues).toContainEqual({ kind: 'livingDiffers', path: 'people/nikdo-1800.md', detail: 'Vault: not Living; the Tree: Living' });
    // The Event, in the Person's own Proposal, with its Role and the Vault Citation of the note.
    const tomas = p.proposals.find((x) => x.path === 'people/tomas-novak-1770.md')!;
    expect(tomas.ops.filter((o) => o.key.includes('presumed-death')).map((o) => o.op.op)).toEqual(['createEvent', 'addRole', 'attachCitation']);
  });

  it('presumed death through a child: a father whose son was baptized in 1801 is born by 1789 (#132)', async () => {
    await edit('people/tomas-novak-1770.md', "marriages:\n  - spouse: '[[marie-svobodova-1775]]'\n    date: 1799-11-20\n    place: '[[vrbice]]'\n", '');
    await edit('people/marie-svobodova-1775.md', "marriages:\n  - spouse: '[[tomas-novak-1770]]'\n    date: 1799-11-20\n    place: '[[vrbice]]'\n", '');
    const p = await plan();
    expect(p.issues.find((i) => i.kind === 'presumedDeath' && i.path === 'people/tomas-novak-1770.md')!.detail).toBe(
      'Died, date unknown: born by 1789-03-12 at the latest (Jan Novák baptized 1801-03-12; a parent of Jan Novák, at least 12 years older), more than 125 years before 2026-11-02.',
    );
  });

  it('a long log note: its lead keeps the whole note, and knows the first 4,000 characters an earlier run kept (#136)', async () => {
    await writeFile(join(vault.path, 'log/2026-10-25-long.md'), longLog('A long invented session'));
    const p = await plan();
    const lead = p.leads.find((l) => l.path === 'log/2026-10-25-long.md')!;
    const body = longLog('x').split('---\n').slice(2).join('---\n').trim();
    expect(body.length).toBeGreaterThan(10_000);
    expect(lead.reason).toBe(body);
    expect(lead.earlierReason).toBe(body.slice(0, 4000).trim());
    expect(p.issues.filter((i) => i.path === 'log/2026-10-25-long.md')).toEqual([]);
    // A short note's lead is as an earlier run made it.
    expect(p.leads.find((l) => l.path === 'log/2026-10-20-registers.md')!.earlierReason).toBeNull();
  });

  it('fields the Tree has no place for: kept below the body of the research notes, or in a register entry’s Citation note (#134)', async () => {
    const p = await plan();
    const op = (key: string) => ops(p).find((o) => o.key === key)!.op;
    expect(op('notes:person:jan-novak-1801')).toMatchObject({
      notes: 'Baptism found; the death is known from the family only. Check the death register of 1850.\n\nFrom the Vault, not mapped:\n- occupation: sedlák',
    });
    expect(op('notes:parish:vrbice')).toMatchObject({
      notes: 'The invented parish of Vrbice kept the registers of Vrbice and Kamenná Lhota.\n\nFrom the Vault, not mapped:\n- denomination: římskokatolická',
    });
    expect(op('citation:n-vrbice-1801-f12')).toMatchObject({
      note: 'Vault: sources/n-vrbice-1801-f12.md\nScan: https://archive.invalid/registers/123-4/12\nEvidence class: A',
    });
    // The dry run still lists both fields.
    expect(p.issues).toContainEqual({ kind: 'unmappedField', path: 'people/jan-novak-1801.md', detail: 'people.occupation' });
    expect(p.issues).toContainEqual({ kind: 'unmappedField', path: 'sources/n-vrbice-1801-f12.md', detail: 'sources.evidence' });
    // What an importer before #134 wrote instead, for a Tree imported then: the body alone, or nothing.
    expect(p.updates.map((u) => [u.recordKey, u.field, u.before === null ? null : u.before.slice(0, 20), u.lines])).toEqual([
      ['place:kamenna-lhota', 'notes', null, ['district: Invented District', 'names.en: Stone Lhota']],
      ['parish:vrbice', 'notes', 'The invented parish ', ['denomination: římskokatolická']],
      ['citation:n-vrbice-1801-f12', 'note', 'Vault: sources/n-vrb', ['Evidence class: A']],
      ['person:jan-novak-1801', 'notes', 'Baptism found; the d', ['occupation: sedlák']],
      ['source:rod-novaku', 'notes', '# Rod Nováků (invent', ['Evidence class: C']],
    ]);
    for (const u of p.updates) expect(op(u.freshKey)).toMatchObject(u.field === 'notes' ? { notes: u.after } : { note: u.after });
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
