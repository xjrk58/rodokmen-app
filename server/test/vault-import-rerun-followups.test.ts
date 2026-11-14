import {
  BatchList,
  CitationDetail,
  EventDetail,
  LeadList,
  OPERATIONS_VERSION,
  ParishDetail,
  PersonDetail,
  PlaceDetail,
  ProposalList,
  SourceDetail,
} from '@rodokmen/shared';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Account } from '../src/db/types.js';
import type { Municipality } from '../src/vault-import/map-places.js';
import type * as Mapper from '../src/vault-import/mapper.js';
import type { Plan, PlannedOp } from '../src/vault-import/plan.js';
import { runImport, type ImportOptions, type ImportResult } from '../src/vault-import/run.js';
import { createAgentWithToken, ensureOwner, signIn } from './helpers.js';
import { fixtureVault, longLog } from './fixture-vault.js';
import { startLiveServer, type LiveServer } from './live-server.js';

/**
 * A later run over a Tree imported before the follow-ups of the Owner's real import: presumed deaths
 * (#132), fields the Tree has no place for (#134) with register entries' Citation notes (#157), long
 * log notes (#136), Places that are part of a Municipality (#137) and a marriage both spouses record
 * without a Source note (#149). The importer before them is this importer with its plan turned back
 * into what the earlier one planned; the second run is this importer as it is.
 */
const before = vi.hoisted(() => ({ fix: false }));

/** The plan of the importer before #149: the second spouse's note gave the marriage an Event of its own. */
function before149(plan: Plan): void {
  const all = plan.proposals.flatMap((p) => p.ops);
  for (const m of plan.mergedMarriages) {
    const rekey = (o: PlannedOp): PlannedOp => ({
      ...o,
      key: o.key.replace(m.key, m.earlierKey),
      op: { ...o.op, ...Object.fromEntries(Object.entries(o.op).map(([k, v]) => [k, v === `@${m.key}` ? `@${m.earlierKey}` : v])) },
    });
    const created = [all.find((o) => o.key === m.key)!, ...all.filter((o) => o.key.startsWith(`role:${m.key}:`))];
    const p = plan.proposals.find((x) => x.path === m.paths[1])!;
    const first = p.ops.findIndex((o) => o.key.includes(m.key));
    p.ops = [...p.ops.slice(0, first), ...created.map(rekey), ...p.ops.slice(first).map((o) => (o.key.includes(m.key) ? rekey(o) : o))];
  }
}

/** The plan of the importer before #132: no presumed death. */
function before132(plan: Plan): void {
  for (const p of plan.proposals) p.ops = p.ops.filter((o) => !o.key.includes(':presumed-death'));
}

/** The plan of the importer before #134: research notes held the note's body alone (none without one), and a Citation's note the path. */
function before134(plan: Plan): void {
  for (const u of plan.updates.filter((x) => x.topic === 'fields'))
    for (const p of plan.proposals) {
      const i = p.ops.findIndex((o) => o.key === u.freshKey);
      if (i < 0) continue;
      const op = { ...p.ops[i]!.op, ...u.before };
      p.ops = u.before.notes === null ? p.ops.filter((_, j) => j !== i) : p.ops.map((o, j) => (j === i ? { ...o, op, value: JSON.stringify(op) } : o));
    }
}

/** The plan of the importer before #137: a Place was linked only to the Municipality of its own name. */
function before137(plan: Plan): void {
  for (const u of plan.updates.filter((x) => x.topic === 'municipality'))
    for (const o of plan.proposals.flatMap((p) => p.ops))
      if (o.key === u.freshKey) {
        o.op = { ...o.op, ...u.before };
        o.value = JSON.stringify(o.op);
      }
}

/** The plan of the importer before #136: a lead's reason held the first 4,000 characters of its note. */
function before136(plan: Plan): void {
  for (const lead of plan.leads) lead.reason = lead.earlierReason ?? lead.reason;
}

vi.mock('../src/vault-import/mapper.js', async (importOriginal) => {
  const mapper = await importOriginal<typeof Mapper>();
  return {
    ...mapper,
    mapVault: async (...args: Parameters<typeof mapper.mapVault>) => {
      const plan = await mapper.mapVault(...args);
      if (!before.fix) {
        before132(plan);
        before134(plan);
        before136(plan);
        before137(plan);
        before149(plan);
      }
      return plan;
    },
  };
});

const MUNICIPALITIES: Municipality[] = [{ code: '572128', name: 'Vrbice', district: 'Jičín', lat: 50.38, lon: 15.39 }];

describe('a later run over a Tree imported before the follow-ups (#132, #134, #136, #137, #149, #157)', () => {
  let s: LiveServer;
  let token: string;
  let owner: Account;
  let vault: Awaited<ReturnType<typeof fixtureVault>>;
  /** The later run, as a dry run and for real. */
  let dry: ImportResult;
  let second: ImportResult;

  const options = (): ImportOptions => ({
    vault: vault.path,
    url: s.origin,
    token,
    dryRun: false,
    givenBy: 'Owner Example',
    roots: [],
    municipalities: MUNICIPALITIES,
    today: new Date('2026-11-02T12:00:00Z'),
    convert: async (_doc, dir) => {
      const out = join(dir, 'converted.pdf');
      await writeFile(out, Buffer.from('%PDF-1.4\n%%EOF\n'));
      return out;
    },
  });
  const asOwner = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    s.app.inject({ method, url, headers: { cookie: await signIn(s.t.db, s.clock, owner), origin: s.origin }, ...(payload ? { payload } : {}) });
  const acceptBatch = async (id: string, proposals: number) => {
    const res = await asOwner('POST', `/api/batches/${id}/accept`, { proposals });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ failed: [], blocked: [] });
  };
  /** The record the importer created for a Vault key, through its id map. */
  const recordOf = async (key: string) =>
    (
      await s.t.db
        .selectFrom('vault_import_map as m')
        .innerJoin('proposal_temp as t', (j) => j.onRef('t.proposal_id', '=', 'm.proposal_id').onRef('t.temp_id', '=', 'm.temp_id'))
        .select('t.record_id')
        .where('m.key', '=', key)
        .executeTakeFirstOrThrow()
    ).record_id;
  const person = async (key: string) => PersonDetail.parse((await asOwner('GET', `/api/persons/${await recordOf(key)}`)).json());
  const marriages = async () => (await person('person:marie-svobodova-1775')).events.filter((e) => e.event.type === 'marriage');
  const citations = (e: PersonDetail['events'][number]) => e.citations.map((c) => c.page).sort();
  const placeOf = async (key: string) => PlaceDetail.parse((await asOwner('GET', `/api/places/${await recordOf(key)}`)).json());
  const place = async () => placeOf('place:kamenna-lhota');
  const VRBICE = { code: '572128', name: 'Vrbice' };
  const JINDE = { code: '500011', name: 'Jinde' };
  const JAN = 'Baptism found; the death is known from the family only. Check the death register of 1850.';
  const lead = async (question: string) => LeadList.parse((await asOwner('GET', '/api/leads?limit=50')).json()).items.find((l) => l.question === question)!;
  const whole = (topic: string) => longLog(topic).split('---\n').slice(2).join('---\n').trim();
  const shared = 'event:marriage:person:marie-svobodova-1775+person:tomas-novak-1770:vault:marie-svobodova-1775:0';
  const earlier = 'event:marriage:person:marie-svobodova-1775+person:tomas-novak-1770:vault:tomas-novak-1770:0';

  beforeAll(async () => {
    s = await startLiveServer();
    owner = await ensureOwner(s.t.db);
    ({ token } = await createAgentWithToken(s.t.db, s.clock, 'Vault importer'));
    vault = await fixtureVault();
    await writeFile(join(vault.path, 'log/2026-10-25-long.md'), longLog('A long invented session'));
    await writeFile(join(vault.path, 'log/2026-10-26-edited.md'), longLog('A long session the Owner edits'));
    // Two invented hamlets that are part of the Municipality of Vrbice: named by name, and by RÚIAN code.
    await writeFile(join(vault.path, 'places/horni-ves.md'), '---\ntype: place\nname: Horní Ves\nkind: osada\nmunicipality: Vrbice\n---\n');
    await writeFile(join(vault.path, 'places/dolni-ves.md'), '---\ntype: place\nname: Dolní Ves\nkind: osada\nmunicipality: 572128\n---\n');
  }, 60_000);
  afterAll(async () => {
    await s?.close();
    await vault?.remove();
  });

  it('before the fixes: two marriage Events for one pair, and long notes cut at 4,000 characters', async () => {
    const first = await runImport(options());
    const [batch] = BatchList.parse((await asOwner('GET', '/api/batches')).json()).items;
    await acceptBatch(batch!.id, first.run.submitted);
    expect((await marriages()).map(citations).sort()).toEqual([['people/marie-svobodova-1775.md'], ['people/tomas-novak-1770.md']]);
    // The leads that link nothing are created at once; a long note's lead holds its first 4,000 characters.
    expect((await lead('A long invented session')).reason).toBe(whole('A long invented session').slice(0, 4000).trim());
    // The Owner adds to one of them in the app.
    const edited = await lead('A long session the Owner edits');
    const res = await asOwner('PATCH', `/api/leads/${edited.id}`, { baseVersion: edited.version, reason: `${edited.reason}\n\nChecked again in the archive.` });
    expect(res.statusCode, res.body).toBe(200);
    // Research notes as the import wrote them: the body alone, or none; and the Owner adds to the Parish's.
    expect((await person('person:jan-novak-1801')).notes).toBe(JAN);
    expect((await place()).notes).toBeNull();
    const parish = ParishDetail.parse((await asOwner('GET', `/api/parishes/${await recordOf('parish:vrbice')}`)).json());
    const direct = await asOwner('POST', '/api/proposals', {
      formatVersion: OPERATIONS_VERSION,
      idempotencyKey: 'owner-parish-notes',
      direct: true,
      operations: [{ op: 'setNotes', record: 'parish', id: parish.id, baseVersion: parish.version, notes: `${parish.notes}\n\nAsk the parish office.` }],
    });
    expect(direct.statusCode, direct.body).toBe(201);
    // No presumed deaths: Tomáš, Marie and Ludmila have no dates of their own, so the Tree has them Living ...
    for (const key of ['person:tomas-novak-1770', 'person:marie-svobodova-1775', 'person:ludmila-vesela-1805']) expect((await person(key)).living).toBe(true);
    // ... until the Owner records Ludmila's death, and a baptism for Marie, from a family memory.
    const death = await asOwner('POST', '/api/proposals', {
      formatVersion: OPERATIONS_VERSION,
      idempotencyKey: 'owner-ludmila-death',
      direct: true,
      operations: [
        {
          op: 'createCitation',
          tempId: 'tmp:c',
          sourceId: await recordOf('vault-source'),
          page: null,
          transcription: 'Died in Vrbice in 1870, the family says (invented).',
          readOn: '2026-11-01',
          confidence: 'low',
          note: null,
        },
        { op: 'createEvent', tempId: 'tmp:e', type: 'death', date: '1870', placeId: null, houseId: null, description: null },
        { op: 'addRole', eventId: 'tmp:e', personId: await recordOf('person:ludmila-vesela-1805'), role: 'deceased', roleDetail: null },
        { op: 'attachCitation', citationId: 'tmp:c', eventId: 'tmp:e' },
        { op: 'createEvent', tempId: 'tmp:b', type: 'baptism', date: '1940', placeId: null, houseId: null, description: null },
        { op: 'addRole', eventId: 'tmp:b', personId: await recordOf('person:marie-svobodova-1775'), role: 'child', roleDetail: null },
        { op: 'attachCitation', citationId: 'tmp:c', eventId: 'tmp:b' },
      ],
    });
    expect(death.statusCode, death.body).toBe(201);
    // The hamlets came in without a Municipality, and the Owner links one of them to another in the app.
    expect((await placeOf('place:horni-ves')).municipality).toBeNull();
    const dolni = await placeOf('place:dolni-ves');
    expect(dolni.municipality).toBeNull();
    const linked = await asOwner('POST', '/api/proposals', {
      formatVersion: OPERATIONS_VERSION,
      idempotencyKey: 'owner-dolni-ves',
      direct: true,
      operations: [
        {
          op: 'createCitation',
          tempId: 'tmp:c',
          sourceId: await recordOf('vault-source'),
          page: null,
          transcription: 'Dolní Ves belongs to Jinde today (invented).',
          readOn: '2026-11-01',
          confidence: 'low',
          note: null,
        },
        { op: 'setField', record: 'place', id: dolni.id, baseVersion: dolni.version, set: { municipality: JINDE } },
      ],
    });
    expect(linked.statusCode, linked.body).toBe(201);
  });

  it('a later run submits only what the fixes add, and its batch is accepted whole', async () => {
    before.fix = true;
    dry = await runImport({ ...options(), dryRun: true });
    expect((await lead('A long invented session')).reason).toHaveLength(4000);
    second = await runImport(options());
    expect(second.run.submitted).toBe(dry.run.submitted);
    expect(second.run.deferred).toEqual([]);
    await acceptBatch(second.run.batch!.id, second.run.submitted);
  });

  it('a Person the Tree has as the import left them gets the presumed death; one given a death or a birth date since is left out and listed (#132)', async () => {
    for (const run of [dry, second]) expect(run.run.presumedLeftOut).toEqual(['people/ludmila-vesela-1805.md', 'people/marie-svobodova-1775.md']);
    expect(second.report).toContain('- people/ludmila-vesela-1805.md\n- people/marie-svobodova-1775.md');
    const tomas = await person('person:tomas-novak-1770');
    expect(tomas.living).toBe(false);
    expect(tomas.events.filter((e) => e.event.type === 'death').map((e) => [e.event.date, e.event.description?.slice(0, 40)])).toEqual([
      [null, 'Died, date unknown: born by 1787-11-20 a'],
    ]);
    // The Owner's facts decide: Ludmila's death of 1870, and Marie, baptized in 1940, stays Living with no death.
    expect((await person('person:ludmila-vesela-1805')).events.filter((e) => e.event.type === 'death').map((e) => e.event.date)).toEqual(['1870']);
    const marie = await person('person:marie-svobodova-1775');
    expect([marie.living, marie.events.filter((e) => e.event.type === 'death')]).toEqual([true, []]);
  });

  it('research notes and Citation notes that hold what the import wrote get the fields not mapped; those changed since are listed (#134, #157)', async () => {
    for (const run of [dry, second]) {
      expect(run.run.updates.fields.added).toBe(4);
      expect(run.run.updates.fields.notUpdated).toEqual([{ path: 'parishes/vrbice.md', lines: ['denomination: římskokatolická'] }]);
    }
    expect(second.report).toContain('- parishes/vrbice.md: denomination: římskokatolická');
    expect(second.report).not.toContain('- sources/n-vrbice-1801-f12.md: Evidence class: A');
    // Each update is a Proposal of one operation, at the version the importer read; a Citation's note needs no new Citation.
    const { items } = ProposalList.parse((await asOwner('GET', `/api/batches/${second.run.batch!.id}/proposals`)).json());
    const notes = items.filter((p) => p.note?.endsWith('(fields the Tree has no place for)'));
    expect(notes.map((p) => [p.note, p.operations.map((o) => o.operation.op)])).toEqual([
      ['Vault: places/kamenna-lhota.md (fields the Tree has no place for)', ['setNotes']],
      ['Vault: sources/n-vrbice-1801-f12.md (fields the Tree has no place for)', ['setField']],
      ['Vault: people/jan-novak-1801.md (fields the Tree has no place for)', ['setNotes']],
      ['Vault: sources/rod-novaku.md (fields the Tree has no place for)', ['setNotes']],
    ]);
    expect(notes[1]!.operations[0]!.operation).toMatchObject({
      record: 'citation',
      set: { note: 'Vault: sources/n-vrbice-1801-f12.md\nScan: https://archive.invalid/registers/123-4/12\nEvidence class: A' },
    });
    // Accepted, the records are as a fresh import makes them (vault-import.test.ts).
    expect((await person('person:jan-novak-1801')).notes).toBe(`${JAN}\n\nFrom the Vault, not mapped:\n- occupation: sedlák`);
    expect((await place()).notes).toBe('From the Vault, not mapped:\n- district: Invented District\n- names.en: Stone Lhota');
    const source = SourceDetail.parse((await asOwner('GET', `/api/sources/${await recordOf('source:rod-novaku')}`)).json());
    expect(source.notes).toMatch(/\n\nFrom the Vault, not mapped:\n- Evidence class: C$/);
    const citation = CitationDetail.parse((await asOwner('GET', `/api/citations/${await recordOf('citation:n-vrbice-1801-f12')}`)).json());
    expect(citation.note).toBe('Vault: sources/n-vrbice-1801-f12.md\nScan: https://archive.invalid/registers/123-4/12\nEvidence class: A');
    // The Owner's Parish notes stay as they are.
    const parish = ParishDetail.parse((await asOwner('GET', `/api/parishes/${await recordOf('parish:vrbice')}`)).json());
    expect(parish.notes).toMatch(/Ask the parish office\.$/);
  });

  it('a Place that still has no Municipality gets the one its note names; one the Owner linked otherwise since is listed and left alone (#137)', async () => {
    for (const run of [dry, second])
      expect(run.run.updates.municipality).toEqual({ added: 1, notUpdated: [{ path: 'places/dolni-ves.md', lines: ['Vrbice (572128, Jičín)'] }] });
    expect(second.report).toContain('- places/dolni-ves.md: Vrbice (572128, Jičín)');
    // A Municipality is a fact: the Proposal cites the note again, as the Place's own Proposal does.
    const { items } = ProposalList.parse((await asOwner('GET', `/api/batches/${second.run.batch!.id}/proposals`)).json());
    const linked = items.filter((p) => p.note?.endsWith('(the Municipality it is part of)'));
    expect(linked.map((p) => [p.note, p.operations.map((o) => o.operation)])).toEqual([
      [
        'Vault: places/horni-ves.md (the Municipality it is part of)',
        [
          expect.objectContaining({ op: 'createCitation', sourceId: await recordOf('vault-source'), page: 'places/horni-ves.md', confidence: 'low' }),
          expect.objectContaining({ op: 'setField', record: 'place', id: await recordOf('place:horni-ves'), set: { municipality: VRBICE } }),
        ],
      ],
    ]);
    expect((await placeOf('place:horni-ves')).municipality).toEqual(VRBICE);
    expect((await placeOf('place:dolni-ves')).municipality).toEqual(JINDE);
  });

  it('a lead an earlier run cut gets the whole note; one the Owner changed since is listed and left alone (#136)', async () => {
    for (const run of [dry, second]) expect(run.run.leads).toMatchObject({ updated: 1, notUpdated: ['log/2026-10-26-edited.md'] });
    expect(second.report).toContain('- log/2026-10-26-edited.md');
    expect((await lead('A long invented session')).reason).toBe(whole('A long invented session'));
    const edited = (await lead('A long session the Owner edits')).reason;
    expect(edited).toContain('Checked again in the archive.');
    expect(edited.length).toBeLessThan(4100);
  });

  it('the second note is attached to the first Event, and the other Event is listed for the Owner (#149)', async () => {
    const { items } = ProposalList.parse((await asOwner('GET', `/api/batches/${second.run.batch!.id}/proposals`)).json());
    const keep = await recordOf(shared);
    const tomas = items.find((p) => p.note === 'Vault: people/tomas-novak-1770.md')!;
    const attach = tomas.operations.map((o) => o.operation).find((o) => o.op === 'attachCitation' && o.eventId === keep);
    expect(attach).toMatchObject({ citationId: await recordOf('vault-citation:people/tomas-novak-1770.md') });
    // No marriage Event is created, and the one an earlier run created stays: no operation removes an Event.
    expect(items.flatMap((p) => p.operations).filter((o) => o.operation.op === 'createEvent' && o.operation.type === 'marriage')).toEqual([]);
    expect(second.run.duplicateMarriages).toEqual([
      { paths: ['people/marie-svobodova-1775.md', 'people/tomas-novak-1770.md'], keep, other: await recordOf(earlier) },
    ]);
    expect(second.report).toContain(`- people/marie-svobodova-1775.md and people/tomas-novak-1770.md: keep Event ${keep}`);
    const kept = (await marriages()).find((e) => e.event.id === keep)!;
    // The Event to keep is the one a fresh import gives (vault-import.test.ts): both partners, citing each note.
    expect(citations(kept)).toEqual(['people/marie-svobodova-1775.md', 'people/tomas-novak-1770.md']);
    const event = EventDetail.parse((await asOwner('GET', `/api/events/${kept.event.id}`)).json());
    expect(event.roles.map((r) => [r.role, r.person.displayName]).sort()).toEqual([
      ['partner', 'Marie Nováková'],
      ['partner', 'Tomáš Novák'],
    ]);
  });

  it('running once more submits nothing', async () => {
    const third = await runImport(options());
    expect(third.run.submitted).toBe(0);
  });
});
