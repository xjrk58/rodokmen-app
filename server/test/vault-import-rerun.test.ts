import { BatchList, PersonDetail, ProposalList } from '@rodokmen/shared';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Account } from '../src/db/types.js';
import type { Municipality } from '../src/vault-import/map-places.js';
import type * as Mapper from '../src/vault-import/mapper.js';
import { runImport, type ImportOptions } from '../src/vault-import/run.js';
import { createAgentWithToken, ensureOwner, signIn } from './helpers.js';
import { fixtureVault, REGISTER_CITED_BAPTISM } from './fixture-vault.js';
import { startLiveServer, type LiveServer } from './live-server.js';

/**
 * A fact that cites a register note directly (#133), on a Tree imported before the fix: a later run
 * adds the register Citation to the Event already imported, and the parent link that rests on it
 * becomes strong. The importer before the fix is this importer planning without the register
 * Citations, the only records the fix adds.
 */
const before = vi.hoisted(() => ({ fix: false }));
vi.mock('../src/vault-import/mapper.js', async (importOriginal) => {
  const mapper = await importOriginal<typeof Mapper>();
  return {
    ...mapper,
    mapVault: async (...args: Parameters<typeof mapper.mapVault>) => {
      const plan = await mapper.mapVault(...args);
      if (before.fix) return plan;
      return { ...plan, proposals: plan.proposals.map((p) => ({ ...p, ops: p.ops.filter((o) => !o.key.includes('register-citation:')) })) };
    },
  };
});

const MUNICIPALITIES: Municipality[] = [{ code: '572128', name: 'Vrbice', district: 'Jičín', lat: 50.38, lon: 15.39 }];

describe('a later run over a batch imported before register Citations (#133)', () => {
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
  const asOwner = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
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
  const baptismCitations = (p: PersonDetail) =>
    p.events
      .find((e) => e.event.type === 'baptism')!
      .citations.map((c) => [c.sourceTitle, c.page, c.confidence])
      .sort();

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

  it('before the fix: the baptism cites only the Vault, so with Tomáš as Family root his daughter is a Possible relative', async () => {
    const first = await runImport(options());
    expect(first.run.submitted).toBeGreaterThan(0);
    const [batch] = BatchList.parse((await asOwner('GET', '/api/batches')).json()).items;
    await acceptBatch(batch!.id, first.run.submitted);
    const root = await asOwner('PUT', `/api/persons/${await recordOf('person:tomas-novak-1770')}/family-root`, { familyRoot: true });
    expect(root.statusCode, root.body).toBe(200);
    const viktorie = await person('person:viktorie-novakova-1804');
    expect(baptismCitations(viktorie)).toEqual([['Vault (rodokmen-data)', 'people/viktorie-novakova-1804.md', 'low']]);
    expect(viktorie.relation).toBe('possible');
    // Jan's baptism cites its entry note, so his father link was strong already.
    expect((await person('person:jan-novak-1801')).relation).toBe('relative');
  });

  it('a later run submits only the register Citation, attached to the baptism already in the Tree; accepted, she is a Relative', async () => {
    before.fix = true;
    const second = await runImport(options());
    expect(second.run.submitted).toBe(1);
    expect(second.run.deferred).toEqual([]);
    const { items } = ProposalList.parse((await asOwner('GET', `/api/batches/${second.run.batch!.id}/proposals`)).json());
    expect(items.map((p) => p.note)).toEqual(['Vault: people/viktorie-novakova-1804.md']);
    const [create, attach] = items[0]!.operations.map((o) => o.operation);
    expect([create?.op, attach?.op, items[0]!.operations.length]).toEqual(['createCitation', 'attachCitation', 2]);
    expect(create).toMatchObject({ sourceId: await recordOf('register:n-vrbice-1784-1820'), page: null, confidence: 'normal' });
    // The Event the first batch created, by its record id from the id map, at the version the Tree has.
    expect(attach).toMatchObject({ eventId: await recordOf('event:viktorie-novakova-1804:baptism') });
    expect(attach?.op === 'attachCitation' ? attach.baseVersion : null).toBeGreaterThan(0);
    await acceptBatch(second.run.batch!.id, 1);
    const viktorie = await person('person:viktorie-novakova-1804');
    // The same Citations as a fresh import gives (vault-import.test.ts); the Vault's stays.
    expect(baptismCitations(viktorie)).toEqual(REGISTER_CITED_BAPTISM);
    expect(viktorie.relation).toBe('relative');
  });

  it('running once more submits nothing', async () => {
    const third = await runImport(options());
    expect(third.run.submitted).toBe(0);
    expect(third.run.unchanged).toBe(third.plan.proposals.length);
  });
});
