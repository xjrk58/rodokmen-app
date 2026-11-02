import { AcceptBatchResult, BatchList, BatchView, ImportMap, OPERATIONS_VERSION, ProposalList, ProposalView, type OperationInput } from '@rodokmen/shared';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { bearer, createAgentWithToken, errorOf } from './helpers.js';
import { citation, useProposalTestbed } from './proposal-testbed.js';

/**
 * Import batches (review spec, "Proposals in an Import batch build on each other", "Accept a whole
 * Import batch"; agent-access spec, "Import batches have their own limit"; vault-import spec,
 * "Re-runs submit only what is new"; add-vault-import tasks 2.1–2.3 and 3.6).
 */
const L = generateFixture().landmarks;

describe('Import batches', () => {
  const { ready, call, submit, person } = useProposalTestbed();
  let owner: Account;
  let editor: Account;
  let token: string;
  let otherToken: string;
  beforeAll(async () => {
    ({ owner, editor } = ready());
    ({ token } = await createAgentWithToken(ready().t.db, ready().a.clock, 'Vault importer'));
    ({ token: otherToken } = await createAgentWithToken(ready().t.db, ready().a.clock, 'Other agent'));
  });

  const agent = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object, t = token) =>
    ready().a.app.inject({ method, url, headers: bearer(t), ...(payload ? { payload } : {}) });
  const openBatch = async (name = 'Vault import (invented)', t = token) => {
    const res = await agent('POST', '/api/batches', { name, vaultCommit: '4f9c8b9c' }, t);
    expect(res.statusCode, res.body).toBe(201);
    return BatchView.parse(res.json());
  };
  const body = (operations: OperationInput[]) => ({ formatVersion: OPERATIONS_VERSION, idempotencyKey: `b-${randomUUID()}`, note: null, operations });
  const intoBatch = async (batchId: string, operations: OperationInput[], t = token) => agent('POST', `/api/batches/${batchId}/proposals`, body(operations), t);
  const proposal = async (batchId: string, operations: OperationInput[]) => {
    const res = await intoBatch(batchId, operations);
    expect(res.statusCode, res.body).toBe(201);
    return ProposalView.parse(res.json());
  };
  const placeOps = (tag: string): OperationInput[] => [
    ...citation(tag, { page: `places/${tag}.md`, confidence: 'low' }),
    { op: 'createPlace', tempId: 'tmp:place', type: 'village', name: { name: `Invented Ves ${tag}`, language: 'cs' } },
  ];
  const eventAt = (tag: string, placeRef: string): OperationInput[] => [
    ...citation(tag),
    { op: 'createPerson', tempId: 'tmp:p', sex: 'male', name: { given: `Child ${tag}`, surname: 'Invented', type: 'birth', asFound: `Child ${tag}` } },
    { op: 'createEvent', tempId: 'tmp:e', type: 'baptism', date: '1801-03-12', placeId: placeRef },
    { op: 'addRole', eventId: 'tmp:e', personId: 'tmp:p', role: 'child' },
    { op: 'attachCitation', citationId: `tmp:cit${tag}`, eventId: 'tmp:e' },
  ];
  const accept = (m: Account, id: string, payload: object = {}) => call(m, 'POST', `/api/proposals/${id}/accept`, payload);
  const view = async (id: string) => ProposalView.parse((await call(editor, 'GET', `/api/proposals/${id}`)).json());

  it('out of order: a Proposal whose Place an earlier pending one creates is refused, naming that one; after it, it is accepted', async () => {
    const batch = await openBatch();
    const p1 = await proposal(batch.id, placeOps('OO1'));
    const p2 = await proposal(batch.id, eventAt('OO2', `batch:${p1.id}/tmp:place`));
    expect(p2).toMatchObject({ batch: { id: batch.id, position: 1 }, dependsOn: [p1.id], blockedBy: null });
    expect(p2.operations[3]!.summary.en).toBe('adds the baptism on 1801-03-12 at Invented Ves OO1');

    const early = await accept(editor, p2.id);
    expect(early.statusCode).toBe(409);
    expect(errorOf(early)).toMatchObject({ code: 'batch_order' });
    expect(errorOf(early).message).toContain(p1.id);

    expect((await accept(editor, p1.id)).statusCode).toBe(200);
    const ok = await accept(editor, p2.id);
    expect(ok.statusCode, ok.body).toBe(200);
    const place = await ready()
      .t.db.selectFrom('proposal_temp')
      .select('record_id')
      .where('proposal_id', '=', p1.id)
      .where('temp_id', '=', 'tmp:place')
      .executeTakeFirstOrThrow();
    const event = await ready().t.db.selectFrom('event').select('place_id').where('date', '=', '1801-03-12').where('place_id', '=', place.record_id).execute();
    expect(event).toHaveLength(1);
  });

  it('a batch reference must name a record of the right kind that an earlier Proposal of the same batch creates', async () => {
    const batch = await openBatch();
    const p1 = await proposal(batch.id, placeOps('RK1'));
    for (const [ref, message] of [
      [`batch:${p1.id}/tmp:nothing`, /not created there/],
      [`batch:${p1.id}/tmp:srcRK1`, /is a source, not a place/],
      [`batch:${randomUUID()}/tmp:place`, /not a record of an earlier Proposal of this Import batch/],
    ] as const) {
      const res = await intoBatch(batch.id, eventAt('RK2', ref));
      expect(res.statusCode, ref).toBe(400);
      expect(errorOf(res).message).toMatch(message);
    }
    // Outside a batch, or in another Agent's batch, no batch references.
    const outside = await ready().a.app.inject({
      method: 'POST',
      url: '/api/proposals',
      headers: bearer(token),
      payload: body(eventAt('RK3', `batch:${p1.id}/tmp:place`)),
    });
    expect(outside.statusCode).toBe(400);
    expect(errorOf(outside).message).toMatch(/only in a Proposal of an Import batch/);
    const foreign = await intoBatch(batch.id, placeOps('RK4'), otherToken);
    expect(foreign.statusCode).toBe(403);
    // A batch reference of another batch is refused too.
    const second = await openBatch('Second run');
    const across = await intoBatch(second.id, eventAt('RK5', `batch:${p1.id}/tmp:place`));
    expect(across.statusCode).toBe(400);
  });

  it('rejected foundation: rejecting the Proposal that creates a Place blocks those with Events there, naming it, until they are rejected or corrected', async () => {
    const batch = await openBatch();
    const p1 = await proposal(batch.id, placeOps('RF1'));
    const p2 = await proposal(batch.id, eventAt('RF2', `batch:${p1.id}/tmp:place`));
    const p3 = await proposal(batch.id, [...eventAt('RF3', `batch:${p1.id}/tmp:place`)]);
    const p4 = await proposal(batch.id, [
      ...citation('RF4'),
      { op: 'addRole', eventId: `batch:${p2.id}/tmp:e`, personId: `batch:${p2.id}/tmp:p`, role: 'other', roleDetail: 'noted again' },
      { op: 'attachCitation', citationId: 'tmp:citRF4', eventId: `batch:${p2.id}/tmp:e` },
    ]);
    expect((await call(owner, 'POST', `/api/proposals/${p1.id}/reject`, { note: 'Not this Place' })).statusCode).toBe(200);
    expect((await view(p2.id)).blockedBy).toBe(p1.id);
    expect((await view(p3.id)).blockedBy).toBe(p1.id);
    // Through p2, which builds on it.
    expect((await view(p4.id)).blockedBy).toBe(p1.id);
    const counts = BatchView.parse((await call(editor, 'GET', `/api/batches/${batch.id}`)).json()).counts;
    expect(counts).toEqual({ total: 4, pending: 0, blocked: 3, accepted: 0, rejected: 1 });
    const blocked = await accept(editor, p2.id);
    expect(blocked.statusCode).toBe(409);
    expect(errorOf(blocked)).toMatchObject({ code: 'batch_blocked' });
    expect(errorOf(blocked).message).toContain(p1.id);

    // Rejected too: no longer blocked, but rejected; p4 stays blocked.
    expect((await call(editor, 'POST', `/api/proposals/${p2.id}/reject`, {})).statusCode).toBe(200);
    expect((await view(p4.id)).blockedBy).not.toBeNull();
    // Corrected to an existing Place: accepted.
    const event = (await view(p3.id)).operations[3]!.operation;
    expect(event.op).toBe('createEvent');
    const corrected = await accept(editor, p3.id, { corrections: [{ position: 3, operation: { ...event, placeId: L.kamennaLhota } }] });
    expect(corrected.statusCode, corrected.body).toBe(200);
  });

  it('only the Owner accepts a whole batch: an Editor is refused, and can still accept its Proposals one by one', async () => {
    const batch = await openBatch();
    const p1 = await proposal(batch.id, placeOps('ED1'));
    const res = await call(editor, 'POST', `/api/batches/${batch.id}/accept`, { proposals: 1 });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).message).toBe('Only the Owner can do this.');
    expect((await agent('POST', `/api/batches/${batch.id}/accept`, { proposals: 1 })).statusCode).toBe(403);
    expect((await accept(editor, p1.id)).statusCode).toBe(200);
  });

  it(
    'batch with one conflict: of 500, the conflicting one and the one building on it stay pending, the rest are accepted in batch order',
    { timeout: 240_000 },
    async () => {
      const { t } = ready();
      const batch = await openBatch('Large invented import');
      const first = await proposal(batch.id, placeOps('L0'));
      const jan = await person(L.janNovak);
      const ids: string[] = [first.id];
      for (let i = 1; i < 500; i++) {
        let ops: OperationInput[];
        if (i === 250) {
          ops = [
            ...citation(`L${i}`),
            { op: 'setField', record: 'person', id: L.janNovak, baseVersion: jan.version, set: { sex: 'unknown' } },
            { op: 'createPerson', tempId: 'tmp:p', sex: 'female', name: { given: 'Conflicted', surname: 'Invented', type: 'birth', asFound: 'Conflicted' } },
          ];
        } else if (i === 251) {
          ops = [
            ...citation(`L${i}`),
            { op: 'addName', personId: `batch:${ids[250]}/tmp:p`, given: 'Builds', surname: 'On', type: 'other', asFound: 'Builds On' },
          ];
        } else {
          ops = i % 10 === 0 ? eventAt(`L${i}`, `batch:${first.id}/tmp:place`) : placeOps(`L${i}`);
        }
        ids.push((await proposal(batch.id, ops)).id);
      }
      // An Editor changes Jan after the import was submitted.
      const changed = await submit(
        editor,
        [...citation('ED'), { op: 'setField', record: 'person', id: L.janNovak, baseVersion: jan.version, set: { sex: 'female' } }],
        {
          direct: true,
        },
      );
      expect(changed.statusCode, changed.body).toBe(201);

      const before = BatchView.parse((await call(owner, 'GET', `/api/batches/${batch.id}`)).json());
      expect(before.counts).toMatchObject({ total: 500, pending: 500 });
      // A stale confirmation is refused.
      expect((await call(owner, 'POST', `/api/batches/${batch.id}/accept`, { proposals: 499 })).statusCode).toBe(409);
      const res = await call(owner, 'POST', `/api/batches/${batch.id}/accept`, { proposals: 500 });
      expect(res.statusCode, res.body).toBe(200);
      const result = AcceptBatchResult.parse(res.json());
      expect(result.accepted).toHaveLength(498);
      expect(result.failed.map((f) => [f.id, f.position])).toEqual([[ids[250], 250]]);
      expect(result.failed[0]!.message).toMatch(/was changed since the Proposal was written/);
      expect(result.blocked).toEqual([{ id: ids[251], position: 251, blockedBy: ids[250] }]);
      expect((await view(ids[250]!)).status).toBe('pending');
      // In batch order, each logged as accepted by the Owner.
      const log = await t.db
        .selectFrom('log_entry as l')
        .innerJoin('proposal as p', 'p.id', 'l.proposal_id')
        .select(['p.batch_position', 'l.accepted_by'])
        .where('p.batch_id', '=', batch.id)
        .orderBy('l.created_at')
        .execute();
      expect(log.map((l) => l.batch_position)).toEqual([...Array(500).keys()].filter((i) => i !== 250 && i !== 251));
      expect(new Set(log.map((l) => l.accepted_by))).toEqual(new Set([owner.id]));
      expect(BatchView.parse((await call(owner, 'GET', `/api/batches/${batch.id}`)).json()).counts).toEqual({
        total: 500,
        pending: 2,
        blocked: 0,
        accepted: 498,
        rejected: 0,
      });
    },
  );

  it('the review queue shows the batch as one entry; spot-checking samples 20 of its pending Proposals', async () => {
    const batch = await openBatch('Sampled import');
    for (let i = 0; i < 25; i++) await proposal(batch.id, placeOps(`S${i}`));
    const queue = ProposalList.parse((await call(editor, 'GET', '/api/review?limit=100')).json());
    expect(queue.items.some((p) => p.batch !== null)).toBe(false);
    const batches = BatchList.parse((await call(editor, 'GET', '/api/batches')).json()).items;
    expect(batches.find((b) => b.id === batch.id)).toMatchObject({ author: { displayName: 'Vault importer', isAgent: true }, counts: { pending: 25 } });
    const sample = ProposalList.parse((await call(editor, 'GET', `/api/batches/${batch.id}/proposals?sample=20`)).json());
    expect(new Set(sample.items.map((p) => p.id)).size).toBe(20);
    expect(sample.items.every((p) => p.status === 'pending' && p.batch?.id === batch.id)).toBe(true);
    const ordered = ProposalList.parse((await call(editor, 'GET', `/api/batches/${batch.id}/proposals?limit=10&offset=5`)).json());
    expect(ordered.items.map((p) => p.batch!.position)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect((await agent('GET', `/api/batches/${batch.id}/proposals?sample=20`)).statusCode).toBe(403);
  });

  it("the import's own limit: past the hourly 60 Proposals, the importing Agent still submits into its batch, and nowhere else", async () => {
    const { t, a } = ready();
    const batch = await openBatch('Limited import');
    const agentId = (await t.db.selectFrom('account').select('id').where('display_name', '=', 'Vault importer').executeTakeFirstOrThrow()).id;
    await t.db
      .insertInto('agent_rate_window')
      .values({ account_id: agentId, kind: 'proposal', window_start: a.clock.now(), count: 60 })
      .onConflict((oc) => oc.columns(['account_id', 'kind']).doUpdateSet({ window_start: a.clock.now(), count: 60 }))
      .execute();
    expect((await intoBatch(batch.id, placeOps('LIM1'))).statusCode).toBe(201);
    const elsewhere = await agent('POST', '/api/proposals', body(placeOps('LIM2')));
    expect(elsewhere.statusCode).toBe(429);
  });

  it("the id map: entries by key for the Agent's own batches, with the Tree record once the Proposal that creates it is accepted", async () => {
    const batch = await openBatch('Mapped import');
    const p = await proposal(batch.id, placeOps('MAP'));
    const entries = [
      { key: 'places/invented-ves.md', kind: 'note', noteHash: 'h1', batchId: batch.id },
      { key: 'place:invented-ves', kind: 'place', noteHash: 'h1', batchId: batch.id, proposalId: p.id, tempId: 'tmp:place' },
    ];
    const put = await agent('PUT', '/api/import-map', { entries });
    expect(put.statusCode, put.body).toBe(200);
    expect((await agent('PUT', '/api/import-map', { entries }, otherToken)).statusCode).toBe(403);
    const pending = ImportMap.parse((await agent('GET', '/api/import-map?limit=1')).json());
    expect(pending.entries).toHaveLength(1);
    expect(pending.next).not.toBeNull();
    const all = ImportMap.parse((await agent('GET', '/api/import-map')).json()).entries;
    expect(all.find((e) => e.key === 'place:invented-ves')).toMatchObject({ proposalStatus: 'pending', recordId: null });
    expect((await accept(editor, p.id)).statusCode).toBe(200);
    const after = ImportMap.parse((await agent('GET', '/api/import-map')).json()).entries.find((e) => e.key === 'place:invented-ves')!;
    expect(after.proposalStatus).toBe('accepted');
    const place = await ready()
      .t.db.selectFrom('proposal_temp')
      .select('record_id')
      .where('proposal_id', '=', p.id)
      .where('temp_id', '=', 'tmp:place')
      .executeTakeFirstOrThrow();
    expect(after.recordId).toBe(place.record_id);
  });
});
