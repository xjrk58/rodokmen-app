import { BatchList, EventDetail, PersonDetail, ProposalList } from '@rodokmen/shared';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Account } from '../src/db/types.js';
import type { Municipality } from '../src/vault-import/map-places.js';
import type * as Mapper from '../src/vault-import/mapper.js';
import type { Plan, PlannedOp } from '../src/vault-import/plan.js';
import { runImport, type ImportOptions } from '../src/vault-import/run.js';
import { createAgentWithToken, ensureOwner, signIn } from './helpers.js';
import { fixtureVault } from './fixture-vault.js';
import { startLiveServer, type LiveServer } from './live-server.js';

/**
 * A later run over a Tree imported before the follow-ups of the Owner's real import: a marriage both
 * spouses record without a Source note (#149). The importer before them is this importer with its
 * plan turned back into what the earlier one planned; the second run is this importer as it is.
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

vi.mock('../src/vault-import/mapper.js', async (importOriginal) => {
  const mapper = await importOriginal<typeof Mapper>();
  return {
    ...mapper,
    mapVault: async (...args: Parameters<typeof mapper.mapVault>) => {
      const plan = await mapper.mapVault(...args);
      if (!before.fix) before149(plan);
      return plan;
    },
  };
});

const MUNICIPALITIES: Municipality[] = [{ code: '572128', name: 'Vrbice', district: 'Jičín', lat: 50.38, lon: 15.39 }];

describe('a later run over a Tree imported before the follow-ups (#149)', () => {
  let s: LiveServer;
  let token: string;
  let owner: Account;
  let vault: Awaited<ReturnType<typeof fixtureVault>>;

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
  const asOwner = async (method: 'GET' | 'POST', url: string, payload?: object) =>
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
  const shared = 'event:marriage:person:marie-svobodova-1775+person:tomas-novak-1770:vault:marie-svobodova-1775:0';
  const earlier = 'event:marriage:person:marie-svobodova-1775+person:tomas-novak-1770:vault:tomas-novak-1770:0';

  beforeAll(async () => {
    s = await startLiveServer();
    owner = await ensureOwner(s.t.db);
    ({ token } = await createAgentWithToken(s.t.db, s.clock, 'Vault importer'));
    vault = await fixtureVault();
  }, 60_000);
  afterAll(async () => {
    await s?.close();
    await vault?.remove();
  });

  it('before the fixes: the marriage Tomáš and Marie both record without a Source note is two Events, one per note', async () => {
    const first = await runImport(options());
    const [batch] = BatchList.parse((await asOwner('GET', '/api/batches')).json()).items;
    await acceptBatch(batch!.id, first.run.submitted);
    expect((await marriages()).map(citations).sort()).toEqual([['people/marie-svobodova-1775.md'], ['people/tomas-novak-1770.md']]);
  });

  it('a later run attaches the second note to the first Event and lists the other for the Owner (#149)', async () => {
    before.fix = true;
    const second = await runImport(options());
    expect(second.run.deferred).toEqual([]);
    const { items } = ProposalList.parse((await asOwner('GET', `/api/batches/${second.run.batch!.id}/proposals`)).json());
    const keep = await recordOf(shared);
    const tomas = items.find((p) => p.note === 'Vault: people/tomas-novak-1770.md')!;
    const attach = tomas.operations.map((o) => o.operation).find((o) => o.op === 'attachCitation' && o.eventId === keep);
    expect(attach).toMatchObject({ citationId: await recordOf('vault-citation:people/tomas-novak-1770.md') });
    // No Event is created, and the one an earlier run created stays: no operation removes an Event.
    expect(items.flatMap((p) => p.operations).filter((o) => o.operation.op === 'createEvent' && o.operation.type === 'marriage')).toEqual([]);
    expect(second.run.duplicateMarriages).toEqual([
      { paths: ['people/marie-svobodova-1775.md', 'people/tomas-novak-1770.md'], keep, other: await recordOf(earlier) },
    ]);
    expect(second.report).toContain(`- people/marie-svobodova-1775.md and people/tomas-novak-1770.md: keep Event ${keep}`);
    await acceptBatch(second.run.batch!.id, second.run.submitted);
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
