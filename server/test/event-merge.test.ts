import { EventDetail, History, MergeRefused, ProposalView, type OperationInput } from '@rodokmen/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import type { TestDatabase } from './db.js';
import { errorOf } from './helpers.js';
import { citation, useProposalTestbed } from './proposal-testbed.js';

const L = generateFixture().landmarks;

/** A record as the API shows it, without the versions an undo moves on. */
const withoutVersions = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutVersions)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).flatMap(([k, v]) => (k === 'version' ? [] : [[k, withoutVersions(v)]])))
      : value;

/**
 * Merging a duplicate Event into another (add-event-merge, #154): review "Merging duplicate Events",
 * "A merged Event fills the gaps of the kept one" and "Merging Events refuses disagreeing facts",
 * proposals "Evidence is required", tree-read-api "A merged Event answers with the kept one" and
 * family-view "Merge duplicate Events from the person page" (its data). Invented people only.
 */
describe('Merging duplicate Events', () => {
  const { ready, call, submit, person, count } = useProposalTestbed();
  let t: TestDatabase;
  let editor: Account;
  let contributor: Account;
  let owner: Account;
  beforeAll(() => ({ t, editor, contributor, owner } = ready()));

  const event = async (id: string) => {
    const res = await call(contributor, 'GET', `/api/events/${id}`);
    if (res.statusCode !== 200) throw new Error(`GET event ${id}: ${res.statusCode} ${res.body}`);
    return EventDetail.parse(res.json());
  };
  /** Accepts a contributor's Proposal and returns the records its temporary ids became. */
  async function accepted(operations: OperationInput[]): Promise<Map<string, string>> {
    const p = ProposalView.parse((await submit(contributor, operations)).json());
    const res = await call(editor, 'POST', `/api/proposals/${p.id}/accept`, {});
    expect(res.statusCode, res.body).toBe(200);
    // The records it created, in the order its operations created them (the log keeps that order).
    const created = await t.db
      .selectFrom('log_change as c')
      .innerJoin('log_entry as l', 'l.id', 'c.log_entry_id')
      .select(['c.record_table', 'c.record_id'])
      .where('l.proposal_id', '=', p.id)
      .where('c.before', 'is', null)
      .orderBy('c.seq')
      .execute();
    const TABLES: Record<string, string> = { createPerson: 'person', createEvent: 'event', createSource: 'source', createCitation: 'citation' };
    const temps = new Map<string, string>();
    for (const op of operations) {
      const table = TABLES[op.op];
      if (!table || !('tempId' in op) || !op.tempId) continue;
      const next = created.findIndex((c) => c.record_table === table);
      temps.set(op.tempId, created.splice(next, 1)[0]!.record_id);
    }
    return temps;
  }
  const merge = async (keepId: string, mergeId: string, by: Account = editor, note: string | null = null) => {
    const [keep, gone] = [await event(keepId), await event(mergeId)];
    return call(by, 'POST', `/api/events/${keepId}/merge`, { mergeId, keepBaseVersion: keep.version, mergeBaseVersion: gone.version, note });
  };
  const citationsOf = async (id: string) => (await event(id)).citations.map((c) => c.id).sort();
  const rolesOf = async (id: string) => (await event(id)).roles.map((r) => `${r.person.displayName}:${r.role}`).sort();

  /** A couple, and their marriage twice, as an importer before #149 left it once its later run (#158) was accepted. */
  async function marriageTwice(tag: string) {
    const first = await accepted([
      { op: 'createPerson', tempId: 'tmp:a', sex: 'male', name: { given: 'Bohumil', surname: `Vymyšlený${tag}`, type: 'birth', asFound: 'Bohumil' } },
      { op: 'createPerson', tempId: 'tmp:b', sex: 'female', name: { given: 'Ludmila', surname: `Vymyšlená${tag}`, type: 'birth', asFound: 'Ludmila' } },
      { op: 'createEvent', tempId: 'tmp:m', type: 'marriage', date: '1801-11-20', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:m', personId: 'tmp:a', role: 'partner' },
      { op: 'addRole', eventId: 'tmp:m', personId: 'tmp:b', role: 'partner' },
      ...citation(`${tag}1`),
      { op: 'attachCitation', citationId: `tmp:cit${tag}1`, eventId: 'tmp:m' },
    ]);
    const [a, b, kept] = [first.get('tmp:a')!, first.get('tmp:b')!, first.get('tmp:m')!];
    const keepVersion = (await event(kept)).version;
    const second = await accepted([
      { op: 'createEvent', tempId: 'tmp:m', type: 'marriage', date: '1801-11-20', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:m', personId: a, role: 'partner' },
      { op: 'addRole', eventId: 'tmp:m', personId: b, role: 'partner' },
      ...citation(`${tag}2`),
      { op: 'attachCitation', citationId: `tmp:cit${tag}2`, eventId: 'tmp:m' },
      { op: 'attachCitation', citationId: `tmp:cit${tag}2`, eventId: kept, baseVersion: keepVersion },
    ]);
    const [own, attached] = [first.get(`tmp:cit${tag}1`)!, second.get(`tmp:cit${tag}2`)!];
    return { a, b, kept, other: second.get('tmp:m')!, citations: [own, attached].sort(), otherCitation: attached };
  }

  let married: Awaited<ReturnType<typeof marriageTwice>>;
  let mergeProposal: string;

  it('the person page offers the pair, with the Event that has more Citations to keep', async () => {
    married = await marriageTwice('A');
    expect((await person(married.a)).mergeableEvents).toEqual([{ keepId: married.kept, mergeId: married.other }]);
    expect((await person(married.b, editor)).mergeableEvents).toEqual([{ keepId: married.kept, mergeId: married.other }]);
  });

  it('marriage recorded twice: one Event remains with both partner Roles once and both Citations, without a Citation of its own', async () => {
    const events = await count('event');
    const res = await merge(married.kept, married.other, editor, 'One marriage, recorded in both spouses’ notes');
    expect(res.statusCode, res.body).toBe(200);
    const view = ProposalView.parse(res.json());
    expect(view).toMatchObject({ kind: 'direct', status: 'accepted', note: 'One marriage, recorded in both spouses’ notes', citations: [] });
    expect(view.operations[0]!.summary.en).toBe('merges the marriage of 1801-11-20 into the marriage of 1801-11-20');
    expect(view.operations[0]!.summary.cs).toBe('slučuje událost sňatek 1801-11-20 do události sňatek 1801-11-20');
    mergeProposal = view.id;
    expect(await count('event')).toBe(events - 1);
    expect(await rolesOf(married.kept)).toEqual([`Bohumil VymyšlenýA:partner`, `Ludmila VymyšlenáA:partner`]);
    expect(await citationsOf(married.kept)).toEqual(married.citations);
    const page = await person(married.a);
    expect(page.events.map((e) => e.event.id)).toEqual([married.kept]);
    expect(page.mergeableEvents).toEqual([]);
  });

  it('the merged Event answers with the kept one', async () => {
    const res = await call(contributor, 'GET', `/api/events/${married.other}`);
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe(`/api/events/${married.kept}`);
    expect((await call(contributor, 'GET', '/api/events/0192f0c4-7a1e-7c3b-9d2a-0000000000ff')).statusCode).toBe(404);
  });

  it('an operation on the merged Event is refused with event_merged; merging it again, too', async () => {
    const res = await submit(editor, [...citation('E'), { op: 'attachCitation', citationId: 'tmp:citE', eventId: married.other, baseVersion: 1 }], {
      direct: true,
    });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('event_merged');
    const again = await call(editor, 'POST', `/api/events/${married.other}/merge`, { mergeId: married.kept, keepBaseVersion: 1, mergeBaseVersion: 1 });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).code).toBe('event_merged');
  });

  it('the history of the kept Event, the merged Event and both partners shows the merge', async () => {
    for (const [kind, id] of [
      ['event', married.kept],
      ['event', married.other],
      ['person', married.a],
      ['person', married.b],
    ] as const) {
      const items = History.parse((await call(contributor, 'GET', `/api/history/${kind}/${id}`)).json()).items;
      expect(items[0], `${kind} ${id}`).toMatchObject({ proposalId: mergeProposal, kind: 'direct' });
    }
  });

  it('undo an Event merge: both Events exist again with their own Roles and Citations, and the history shows both', async () => {
    const res = await call(editor, 'POST', `/api/proposals/${mergeProposal}/undo`, { note: 'Two weddings after all' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await call(contributor, 'GET', `/api/events/${married.other}`)).statusCode).toBe(200);
    expect(await rolesOf(married.other)).toEqual([`Bohumil VymyšlenýA:partner`, `Ludmila VymyšlenáA:partner`]);
    expect(await citationsOf(married.other)).toEqual([married.otherCitation]);
    expect(await citationsOf(married.kept)).toEqual(married.citations);
    const items = History.parse((await call(contributor, 'GET', `/api/history/event/${married.other}`)).json()).items;
    expect(items.map((i) => i.kind).slice(0, 2)).toEqual(['undo', 'direct']);
    expect((await person(married.a)).mergeableEvents).toEqual([{ keepId: married.kept, mergeId: married.other }]);
  });

  it('gaps are filled, Roles and Citations the kept Event lacks move, notes and descriptions are joined; the undo puts it all back', async () => {
    const ids = await accepted([
      { op: 'createPerson', tempId: 'tmp:x', sex: 'male', name: { given: 'Prokop', surname: 'Vymyšlený', type: 'birth', asFound: 'Procopius' } },
      { op: 'createPerson', tempId: 'tmp:y', sex: 'female', name: { given: 'Dorota', surname: 'Vymyšlená', type: 'birth', asFound: 'Dorothea' } },
      { op: 'createEvent', tempId: 'tmp:e1', type: 'burial', date: '1850-03-02', description: null },
      { op: 'addRole', eventId: 'tmp:e1', personId: 'tmp:x', role: 'deceased' },
      { op: 'setNotes', record: 'event', id: 'tmp:e1', notes: 'Entry checked against the index' },
      { op: 'createEvent', tempId: 'tmp:e2', type: 'burial', date: null, placeId: L.kamennaLhota, description: 'Buried by the chaplain' },
      { op: 'addRole', eventId: 'tmp:e2', personId: 'tmp:x', role: 'deceased' },
      { op: 'addRole', eventId: 'tmp:e2', personId: 'tmp:y', role: 'informant' },
      { op: 'setNotes', record: 'event', id: 'tmp:e2', notes: 'Name hard to read' },
      ...citation('B1'),
      { op: 'attachCitation', citationId: 'tmp:citB1', eventId: 'tmp:e1' },
      ...citation('B2'),
      { op: 'attachCitation', citationId: 'tmp:citB2', eventId: 'tmp:e2' },
    ]);
    const [kept, other] = [ids.get('tmp:e1')!, ids.get('tmp:e2')!];
    const before = { kept: await event(kept), other: await event(other) };
    const res = await merge(kept, other);
    expect(res.statusCode, res.body).toBe(200);
    const after = await event(kept);
    expect(after).toMatchObject({
      date: '1850-03-02',
      place: { id: L.kamennaLhota },
      description: 'Buried by the chaplain',
      notes: 'Entry checked against the index\n\nName hard to read',
    });
    expect(await rolesOf(kept)).toEqual(['Dorota Vymyšlená:informant', 'Prokop Vymyšlený:deceased']);
    expect(await citationsOf(kept)).toEqual([ids.get('tmp:citB1')!, ids.get('tmp:citB2')!].sort());

    const undo = await call(editor, 'POST', `/api/proposals/${ProposalView.parse(res.json()).id}/undo`, {});
    expect(undo.statusCode, undo.body).toBe(200);
    const back = { kept: await event(kept), other: await event(other) };
    for (const which of ['kept', 'other'] as const) expect(withoutVersions(back[which]), which).toEqual(withoutVersions(before[which]));
  });

  it('refuses, naming each fact, and changes nothing: date, type, place, Roles, text too long', async () => {
    const baptisms = async (a: Partial<Record<string, unknown>>, b: Partial<Record<string, unknown>>, roleB = 'tmp:c') => {
      const ids = await accepted([
        { op: 'createPerson', tempId: 'tmp:c', sex: 'male', name: { given: 'Matěj', surname: 'Vymyšlený', type: 'birth', asFound: 'Mathias' } },
        { op: 'createPerson', tempId: 'tmp:d', sex: 'male', name: { given: 'Jakub', surname: 'Vymyšlený', type: 'birth', asFound: 'Jacobus' } },
        { op: 'createEvent', tempId: 'tmp:e1', type: 'baptism', date: '1812-02-11', placeId: L.kamennaLhota, ...a },
        { op: 'addRole', eventId: 'tmp:e1', personId: 'tmp:c', role: 'child' },
        { op: 'createEvent', tempId: 'tmp:e2', type: 'baptism', date: '1812-02-11', placeId: L.kamennaLhota, ...b },
        { op: 'addRole', eventId: 'tmp:e2', personId: roleB, role: 'child' },
        ...citation('R'),
        { op: 'attachCitation', citationId: 'tmp:citR', eventId: 'tmp:e1' },
      ]);
      return [ids.get('tmp:e1')!, ids.get('tmp:e2')!] as const;
    };
    const cases: Array<[string, Awaited<ReturnType<typeof baptisms>>]> = [
      ['date', await baptisms({}, { date: '1812-02-12' })],
      ['type', await baptisms({}, { type: 'birth' })],
      ['place', await baptisms({}, { placeId: L.vrbice })],
      ['roles', await baptisms({}, {}, 'tmp:d')],
      ['description', await baptisms({ description: 'x'.repeat(3000) }, { description: 'y'.repeat(1500) })],
    ];
    const events = await count('event');
    const logged = await count('log_entry');
    for (const [fact, [kept, other]] of cases) {
      const res = await merge(kept, other);
      expect(res.statusCode, fact).toBe(409);
      expect(MergeRefused.parse(res.json()), fact).toMatchObject({ code: 'merge_conflict', facts: fact });
    }
    expect(await count('event')).toBe(events);
    expect(await count('log_entry')).toBe(logged);
  });

  it('another partner is refused; a stale version is a conflict; an Event is never merged into itself; an unknown one is 404', async () => {
    const couple = await marriageTwice('C');
    const third = await accepted([
      { op: 'createPerson', tempId: 'tmp:z', sex: 'female', name: { given: 'Anežka', surname: 'Vymyšlená', type: 'birth', asFound: 'Agnes' } },
      { op: 'createEvent', tempId: 'tmp:m', type: 'marriage', date: '1801-11-20', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:m', personId: couple.a, role: 'partner' },
      { op: 'addRole', eventId: 'tmp:m', personId: 'tmp:z', role: 'partner' },
      ...citation('Z'),
      { op: 'attachCitation', citationId: 'tmp:citZ', eventId: 'tmp:m' },
    ]);
    const another = await merge(couple.kept, third.get('tmp:m')!);
    expect(MergeRefused.parse(another.json())).toMatchObject({ code: 'merge_conflict', facts: 'roles' });
    expect((await person(couple.a)).mergeableEvents).toEqual([{ keepId: couple.kept, mergeId: couple.other }]);

    const stale = await call(editor, 'POST', `/api/events/${couple.kept}/merge`, { mergeId: couple.other, keepBaseVersion: 7, mergeBaseVersion: 1 });
    expect(stale.statusCode).toBe(409);
    expect(errorOf(stale).code).toBe('conflict');
    const self = await call(editor, 'POST', `/api/events/${couple.kept}/merge`, { mergeId: couple.kept, keepBaseVersion: 2, mergeBaseVersion: 2 });
    expect(self.statusCode).toBe(400);
    const unknown = await call(editor, 'POST', `/api/events/0192f0c4-7a1e-7c3b-9d2a-0000000000ff/merge`, {
      mergeId: couple.kept,
      keepBaseVersion: 1,
      mergeBaseVersion: 1,
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('Contributors never merge Events, through the route or a Proposal', async () => {
    const couple = await marriageTwice('D');
    expect((await merge(couple.kept, couple.other, contributor)).statusCode).toBe(403);
    const sneaky = await submit(contributor, [{ op: 'mergeEvents', keepId: couple.kept, mergeId: couple.other, keepBaseVersion: 1, mergeBaseVersion: 1 }]);
    expect(sneaky.statusCode).toBe(403);
    expect(errorOf(sneaky).message).toContain('only Editors merge Events');
  });

  it("an Editor's merge in a Proposal for review is accepted by another Editor; merges follow on: the redirect names the Event that remains", async () => {
    const couple = await marriageTwice('F');
    const [keep, gone] = [await event(couple.kept), await event(couple.other)];
    const pending = ProposalView.parse(
      (
        await submit(editor, [{ op: 'mergeEvents', keepId: couple.kept, mergeId: couple.other, keepBaseVersion: keep.version, mergeBaseVersion: gone.version }])
      ).json(),
    );
    expect(pending.status).toBe('pending');
    expect((await call(owner, 'POST', `/api/proposals/${pending.id}/accept`, {})).statusCode).toBe(200);
    // A third record of the same marriage, merged into by the first kept one.
    const third = await accepted([
      { op: 'createEvent', tempId: 'tmp:m', type: 'marriage', date: '1801-11-20', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:m', personId: couple.a, role: 'partner' },
      ...citation('G'),
      { op: 'attachCitation', citationId: 'tmp:citG', eventId: 'tmp:m' },
    ]);
    const last = third.get('tmp:m')!;
    // The newer Event has fewer Citations, so the page suggests keeping the older one; merge the other way on purpose.
    expect((await person(couple.a)).mergeableEvents).toEqual([{ keepId: couple.kept, mergeId: last }]);
    expect((await merge(last, couple.kept)).statusCode).toBe(200);
    const res = await call(contributor, 'GET', `/api/events/${couple.other}`);
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe(`/api/events/${last}`);
    expect(await rolesOf(last)).toEqual([`Bohumil VymyšlenýF:partner`, `Ludmila VymyšlenáF:partner`]);
  });

  it("an Editor's merge in review that the Events no longer agree on: accepting it is a conflict, and resolved, a refusal; a direct one too", async () => {
    const couple = await marriageTwice('R');
    const [keep, gone] = [await event(couple.kept), await event(couple.other)];
    const op = { op: 'mergeEvents' as const, keepId: couple.kept, mergeId: couple.other, keepBaseVersion: keep.version, mergeBaseVersion: gone.version };
    const pending = ProposalView.parse((await submit(editor, [op])).json());
    // Meanwhile one of the two is dated a day later, with its evidence.
    const dated = await submit(
      editor,
      [
        ...citation('RD'),
        { op: 'setField', record: 'event', id: couple.other, baseVersion: gone.version, set: { date: '1801-11-21' } },
        { op: 'attachCitation', citationId: 'tmp:citRD', eventId: couple.other, baseVersion: gone.version },
      ],
      { direct: true },
    );
    expect(dated.statusCode, dated.body).toBe(201);
    const conflict = await call(owner, 'POST', `/api/proposals/${pending.id}/accept`, {});
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(errorOf(conflict).code).toBe('conflict');
    const refused = await call(owner, 'POST', `/api/proposals/${pending.id}/accept`, { resolutions: [{ position: 0, fields: {} }] });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(errorOf(refused).code).toBe('merge_conflict');
    const direct = await submit(editor, [{ ...op, mergeBaseVersion: (await event(couple.other)).version }], { direct: true });
    expect(direct.statusCode, direct.body).toBe(409);
    expect(errorOf(direct).code).toBe('merge_conflict');
    expect((await event(couple.other)).date).toBe('1801-11-21');
    expect(await rolesOf(couple.kept)).toEqual([`Bohumil VymyšlenýR:partner`, `Ludmila VymyšlenáR:partner`]);
  });

  it('undoing the undo of a merge whose Roles and Citations moved merges the Events again', async () => {
    const ids = await accepted([
      { op: 'createPerson', tempId: 'tmp:x', sex: 'male', name: { given: 'Hynek', surname: 'Vymyšlený', type: 'birth', asFound: 'Ignatius' } },
      { op: 'createPerson', tempId: 'tmp:y', sex: 'female', name: { given: 'Běta', surname: 'Vymyšlená', type: 'birth', asFound: 'Elisabetha' } },
      { op: 'createEvent', tempId: 'tmp:e1', type: 'burial', date: '1840-01-05', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:e1', personId: 'tmp:x', role: 'deceased' },
      { op: 'createEvent', tempId: 'tmp:e2', type: 'burial', date: '1840-01-05', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:e2', personId: 'tmp:x', role: 'deceased' },
      { op: 'addRole', eventId: 'tmp:e2', personId: 'tmp:y', role: 'informant' },
      ...citation('U1'),
      { op: 'attachCitation', citationId: 'tmp:citU1', eventId: 'tmp:e1' },
      ...citation('U2'),
      { op: 'attachCitation', citationId: 'tmp:citU2', eventId: 'tmp:e2' },
    ]);
    const [kept, other] = [ids.get('tmp:e1')!, ids.get('tmp:e2')!];
    const merged = ProposalView.parse((await merge(kept, other)).json());
    const undo = ProposalView.parse((await call(editor, 'POST', `/api/proposals/${merged.id}/undo`, {})).json());
    const again = await call(editor, 'POST', `/api/proposals/${undo.id}/undo`, {});
    expect(again.statusCode, again.body).toBe(200);
    expect((await call(contributor, 'GET', `/api/events/${other}`)).statusCode).toBe(308);
    expect(await rolesOf(kept)).toEqual(['Běta Vymyšlená:informant', 'Hynek Vymyšlený:deceased']);
  });

  it('two residences in different years are not offered', async () => {
    const ids = await accepted([
      { op: 'createPerson', tempId: 'tmp:r', sex: 'male', name: { given: 'Václav', surname: 'Vymyšlený', type: 'birth', asFound: 'Wenzel' } },
      { op: 'createEvent', tempId: 'tmp:r1', type: 'residence', date: '1840', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:r1', personId: 'tmp:r', role: 'other' },
      { op: 'createEvent', tempId: 'tmp:r2', type: 'residence', date: '1850', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:r2', personId: 'tmp:r', role: 'other' },
      ...citation('H'),
      { op: 'attachCitation', citationId: 'tmp:citH', eventId: 'tmp:r1' },
    ]);
    expect((await person(ids.get('tmp:r')!)).mergeableEvents).toEqual([]);
  });
});
