import { BatchList, EventDetail, LeadList, PersonDetail, ProposalList } from '@rodokmen/shared';
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
 * A later run over a Tree imported before the follow-ups of the Owner's real import: long log notes
 * (#136) and a marriage both spouses record without a Source note (#149). The importer before them
 * is this importer with its plan turned back into what the earlier one planned; the second run is
 * this importer as it is.
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
        before136(plan);
        before149(plan);
      }
      return plan;
    },
  };
});

const MUNICIPALITIES: Municipality[] = [{ code: '572128', name: 'Vrbice', district: 'Jičín', lat: 50.38, lon: 15.39 }];

describe('a later run over a Tree imported before the follow-ups (#136, #149)', () => {
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
