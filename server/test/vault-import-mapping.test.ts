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
    const start = (v: unknown) => (typeof v === 'string' ? v.slice(0, 20) : v);
    expect(p.updates.map((u) => [u.recordKey, u.topic, Object.entries(u.before).map(([k, v]) => [k, start(v)]), u.lines])).toEqual([
      ['place:kamenna-lhota', 'fields', [['notes', null]], ['district: Invented District', 'names.en: Stone Lhota']],
      ['parish:vrbice', 'fields', [['notes', 'The invented parish ']], ['denomination: římskokatolická']],
      ['citation:n-vrbice-1801-f12', 'fields', [['note', 'Vault: sources/n-vrb']], ['Evidence class: A']],
      ['person:jan-novak-1801', 'fields', [['notes', 'Baptism found; the d']], ['occupation: sedlák']],
      ['source:rod-novaku', 'fields', [['notes', '# Rod Nováků (invent']], ['Evidence class: C']],
    ]);
    for (const u of p.updates) expect(op(u.freshKey)).toMatchObject(u.after);
  });

  it('a Place that is part of a Municipality: linked to the one its note names, by name in its district or by code; one not found is reported and kept (#137)', async () => {
    const place = (id: string, fields: string) => writeFile(join(vault.path, `places/${id}.md`), `---\ntype: place\nkind: osada\n${fields}---\n`);
    await place('horni-ves', 'name: Horní Ves\ndistrict: Jičín\nmunicipality: Vrbice\nlat: 50.39\nlon: 15.41\n');
    await place('dolni-ves', 'name: Dolní Ves\nmunicipality: 572128\n');
    await place('zadni-ves', 'name: Zadní Ves\ndistrict: Jičín\nmunicipality: Nikde\n');
    const p = await plan();
    const op = (key: string) => ops(p).find((o) => o.key === key)!.op;
    const vrbice = { code: '572128', name: 'Vrbice' };
    // Linked, but a part keeps its own point, or none: the Municipality's point is not the Place's.
    expect(op('place:horni-ves')).toMatchObject({ municipality: vrbice, location: { lat: 50.39, lon: 15.41 } });
    expect(op('place:dolni-ves')).toMatchObject({ municipality: vrbice, location: null });
    expect(op('place:zadni-ves')).toMatchObject({ municipality: null, location: null });
    // The dry run lists the district of a Place no longer once its note names the Municipality; the research notes keep it.
    expect(p.issues.filter((i) => i.path.endsWith('-ves.md')).map((i) => [i.path, i.detail])).toEqual([
      ['places/zadni-ves.md', 'places.municipality: no such Municipality'],
      ['places/zadni-ves.md', 'places.district: no Municipality of that name in that district'],
    ]);
    expect(op('notes:place:horni-ves')).toMatchObject({ notes: 'From the Vault, not mapped:\n- district: Jičín' });
    expect(op('notes:place:zadni-ves')).toMatchObject({ notes: 'From the Vault, not mapped:\n- district: Jičín\n- municipality: Nikde' });
    // What an importer before #137 wrote instead: no Municipality, for a later run to add with the note's Citation as evidence.
    const updates = p.updates.filter((u) => u.topic === 'municipality');
    expect(updates.map((u) => [u.recordKey, u.before, u.after, u.lines])).toEqual([
      ['place:dolni-ves', { municipality: null }, { municipality: vrbice }, ['Vrbice (572128, Jičín)']],
      ['place:horni-ves', { municipality: null }, { municipality: vrbice }, ['Vrbice (572128, Jičín)']],
    ]);
    const evidence = updates[1]!.evidence!;
    expect(evidence.transcription).toContain('municipality: Vrbice');
    expect([evidence.readOn, evidence.note]).toEqual(['2026-11-02', null]);
  });

  it('residence periods: qualified ends kept, an end that is an interval gives its outer end, and the text kept when the date differs (#135)', async () => {
    const periods: Array<[from: string | null, to: string | null]> = [
      ['1801', '1803~'],
      ['1799~', '1800/1801'],
      ['1861/1864', '1866'],
      [null, '1864/1866'],
      ['1801', '1803'],
      ['1825', null],
      ['spring 1801', '1803'],
    ];
    const residences = periods.map(([from, to]) => `  - place: '[[kamenna-lhota]]'\n${from ? `    from: '${from}'\n` : ''}${to ? `    to: '${to}'\n` : ''}`);
    await writeFile(
      join(vault.path, 'people/krystof-vymysleny-1790.md'),
      `---\ntype: person\nname:\n  given: Kryštof\n  surname: Vymyšlený\nsex: M\nresidences:\n${residences.join('')}---\n`,
    );
    const p = await plan();
    const event = (i: number) => ops(p).find((o) => o.key === `event:krystof-vymysleny-1790:residence:${i}`)!.op;
    expect(periods.map((_, i) => [event(i).date, event(i).description])).toEqual([
      ['1801/1803~', null],
      ['1799~/1801', 'Date as written in the Vault: 1799~/1800/1801'],
      ['1861/1866', 'Date as written in the Vault: 1861/1864/1866'],
      ['../1866', 'Date as written in the Vault: ../1864/1866'],
      ['1801/1803', null],
      ['1825', null],
      [null, 'Date as written in the Vault: spring 1801/1803'],
    ]);
    // The dry run lists every date as written that is not EDTF, with the date it gets, if any.
    expect(p.issues.filter((i) => i.path === 'people/krystof-vymysleny-1790.md' && i.kind === 'badDate').map((i) => i.detail)).toEqual([
      'residences.1: 1799~/1800/1801 (dated 1799~/1801)',
      'residences.2: 1861/1864/1866 (dated 1861/1866)',
      'residences.3: ../1864/1866 (dated ../1866)',
      'residences.6: spring 1801/1803',
    ]);
    // An importer before #135 left the first four undated: a later run dates them, citing the note again.
    const updates = p.updates.filter((u) => u.topic === 'date');
    expect(updates.map((u) => [u.recordKey.split(':').at(-1), u.before.date, u.after.date, u.lines])).toEqual([
      ['0', null, '1801/1803~', ['residences.0: 1801/1803~ → 1801/1803~']],
      ['1', null, '1799~/1801', ['residences.1: 1799~/1800/1801 → 1799~/1801']],
      ['2', null, '1861/1866', ['residences.2: 1861/1864/1866 → 1861/1866']],
      ['3', null, '../1866', ['residences.3: ../1864/1866 → ../1866']],
    ]);
    expect(updates[0]!.evidence).toMatchObject({ note: 'The date of residences.0 in the note' });
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
          personKey: 'person:tomas-novak-1770',
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
