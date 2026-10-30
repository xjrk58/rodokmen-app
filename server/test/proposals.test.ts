import { EventDetail, FamilyDetail, History, PersonDetail, PersonSearchResult, ProposalList, ProposalView, UndoPreview, type OperationInput } from '@rodokmen/shared';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, errorOf, idOf, makeApp, MINUTE, signIn, type TestApp } from './helpers.js';

const L = generateFixture().landmarks;
const key = () => randomBytes(9).toString('base64url');

/** A register Citation, as every Proposal needs one (invented Source). */
function citation(tag: string, extra: Partial<Record<string, unknown>> = {}): OperationInput[] {
  return [
    { op: 'createSource', tempId: `tmp:src${tag}`, type: 'parish_register', title: `Invented register ${tag}`, repository: 'Invented archive' },
    { op: 'createCitation', tempId: `tmp:cit${tag}`, sourceId: `tmp:src${tag}`, page: '17', transcription: 'Invented transcription of the entry.', readOn: '2026-10-01', confidence: 'high', ...extra },
  ];
}

describe('Proposals, review, history and undo', () => {
  let t: TestDatabase;
  let a: TestApp;
  let owner: Account;
  let editor: Account;
  let contributor: Account;
  let other: Account;
  const cookies = new Map<string, string>();
  const as = (m: Account) => cookies.get(m.id)!;
  const call = (m: Account, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => a.app.inject({ method, url, headers: { cookie: as(m) }, ...(payload === undefined ? {} : { payload }) });
  const submit = (m: Account, operations: OperationInput[], extra: Record<string, unknown> = {}) =>
    call(m, 'POST', '/api/proposals', { formatVersion: 1, idempotencyKey: key(), note: null, operations, ...extra });
  const person = async (id: string, m: Account = contributor) => PersonDetail.parse((await call(m, 'GET', `/api/persons/${id}`)).json());
  const count = async (table: 'person' | 'name' | 'event' | 'event_role' | 'log_entry' | 'proposal') =>
    (await t.db.selectFrom(table).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n;

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    owner = await ensureOwner(t.db);
    editor = await createMember(t.db, 'editor', { displayName: 'Eva Editor' });
    contributor = await createMember(t.db, 'contributor', { displayName: 'Karel Contributor', language: 'cs' });
    other = await createMember(t.db, 'contributor', { displayName: 'Olga Other' });
    for (const m of [owner, editor, contributor, other]) cookies.set(m.id, await signIn(t.db, a.clock, m));
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  // ---------------------------------------------------------------- 1.2 evidence rule

  it('a Proposal without any Citation is refused and asks for the register entry, a document or a Family account', async () => {
    const res = await submit(contributor, [{ op: 'createPerson', tempId: 'tmp:p', sex: 'female', name: { given: 'Ludmila', surname: 'Invented', type: 'birth', asFound: 'Ludmila Invented' } }]);
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('evidence_missing');
    // In the author's language (Czech here).
    expect(errorOf(res).message).toMatch(/zápis z matriky, dokument nebo rodinné vyprávění/);
  });

  it('a Proposal citing a Family account is accepted for review', async () => {
    const res = await submit(contributor, [
      { op: 'createPerson', tempId: 'tmp:p', sex: 'female', name: { given: 'Ludmila', surname: 'Invented', type: 'birth', asFound: 'Ludmila Invented' } },
      { op: 'createSource', tempId: 'tmp:fa', type: 'family_account', title: 'What grandmother remembers (invented)', familyAccount: { givenBy: 'Invented aunt', givenByPersonId: null, givenOn: '2026-05' } },
      { op: 'createCitation', tempId: 'tmp:c', sourceId: 'tmp:fa', transcription: 'She was called Lída at home.', readOn: '2026-05-10', confidence: 'low' },
    ]);
    expect(res.statusCode).toBe(201);
    const p = ProposalView.parse(res.json());
    expect(p.status).toBe('pending');
    expect(p.citations[0]).toMatchObject({ sourceType: 'family_account', transcription: 'She was called Lída at home.' });
  });

  it('a retried submit with the same idempotency key creates one Proposal', async () => {
    const body = { formatVersion: 1, idempotencyKey: key(), note: 'retry', operations: [...citation('R'), { op: 'attachCitation', citationId: 'tmp:citR', eventId: L.janDeath, baseVersion: 1 }] };
    const before = await count('proposal');
    const first = await call(contributor, 'POST', '/api/proposals', body);
    const second = await call(contributor, 'POST', '/api/proposals', body);
    expect([first.statusCode, second.statusCode]).toEqual([201, 200]);
    expect(idOf(second)).toBe(idOf(first));
    expect(await count('proposal')).toBe(before + 1);
  });

  it('pending Proposals stay private: other Contributors see the Person as accepted so far and cannot open the Proposal', async () => {
    const jan = await person(L.janNovak);
    const res = await submit(contributor, [...citation('P'), { op: 'addName', personId: L.janNovak, baseVersion: jan.version, given: 'Johannes', surname: 'Nowack', type: 'german', asFound: 'Johannes Nowack' }]);
    expect(res.statusCode).toBe(201);
    const after = await person(L.janNovak, other);
    expect(after).toEqual(await person(L.janNovak, owner));
    expect(after.names.map((n) => n.asFound)).not.toContain('Johannes Nowack');
    expect((await call(other, 'GET', `/api/proposals/${idOf(res)}`)).statusCode).toBe(404);
    expect(ProposalList.parse((await call(other, 'GET', '/api/proposals')).json()).items.map((p) => p.id)).not.toContain(idOf(res));
    expect((await call(editor, 'GET', `/api/proposals/${idOf(res)}`)).statusCode).toBe(200);
    expect((await call(contributor, 'GET', `/api/proposals/${idOf(res)}`)).statusCode).toBe(200);
  });

  // ---------------------------------------------------------------- 1.3 one transaction

  it('a failing last operation leaves the Tree unchanged', async () => {
    const baptism = EventDetail.parse((await call(contributor, 'GET', `/api/events/${L.janBaptism}`)).json());
    const childRole = baptism.roles.find((r) => r.role === 'child')!;
    const res = await submit(contributor, [
      { op: 'createPerson', tempId: 'tmp:w', sex: 'male', name: { given: 'Vavřinec', surname: 'Invented', type: 'birth', asFound: 'Laurentius' } },
      { op: 'createEvent', tempId: 'tmp:e', type: 'baptism', date: '1802-01-05', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:e', personId: 'tmp:w', role: 'child' },
      ...citation('F'),
      { op: 'attachCitation', citationId: 'tmp:citF', eventId: 'tmp:e' },
      // Jan already is the child of his own baptism: this last one breaks a rule.
      { op: 'addRole', eventId: L.janBaptism, personId: childRole.person.id, role: 'child', baseVersion: baptism.version },
    ]);
    expect(res.statusCode).toBe(201);
    const counts = { persons: await count('person'), names: await count('name'), events: await count('event'), roles: await count('event_role'), log: await count('log_entry') };
    const accept = await call(editor, 'POST', `/api/proposals/${idOf(res)}/accept`, {});
    expect(accept.statusCode).toBe(409);
    expect(errorOf(accept).message).toMatch(/Operation 7/);
    expect({ persons: await count('person'), names: await count('name'), events: await count('event'), roles: await count('event_role'), log: await count('log_entry') }).toEqual(counts);
    expect(ProposalView.parse((await call(editor, 'GET', `/api/proposals/${idOf(res)}`)).json()).status).toBe('pending');
  });

  it('a rule checked at commit (one primary Name) also rolls everything back', async () => {
    const jan = await person(L.janNovak);
    const latin = jan.names.find((n) => n.type === 'latin')!;
    // The database refuses a Name with neither given name nor surname only at the end.
    const res = await submit(editor, [...citation('C'), { op: 'createPerson', tempId: 'tmp:x', sex: 'male', name: { given: 'Ondřej', surname: 'Invented', type: 'birth', asFound: 'Ondřej' } }, { op: 'setField', record: 'name', id: latin.id, baseVersion: latin.version, set: { given: '', surname: '' } }], { direct: true });
    expect(res.statusCode).toBe(409);
    expect((await person(L.janNovak)).names.find((n) => n.id === latin.id)!.given).toBe(latin.given);
  });

  // ---------------------------------------------------------------- 1.4 direct changes

  it("an Editor's typo fix is visible at once and appears in the record's history under the Editor's name", async () => {
    const jan = await person(L.janNovak);
    const german = jan.names.find((n) => n.type === 'german')!;
    const res = await submit(
      editor,
      [
        { op: 'setField', record: 'name', id: german.id, baseVersion: german.version, set: { asFound: 'Johann Nowack' } },
        // The register entry that shows the spelling (the Citation of Jan's Latin Name).
        { op: 'attachCitation', citationId: jan.names.find((n) => n.type === 'latin')!.citations[0]!.id, nameId: german.id, baseVersion: german.version },
      ],
      { direct: true },
    );
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ kind: 'direct', status: 'accepted', decidedBy: { displayName: 'Eva Editor' } });
    expect((await person(L.janNovak)).names.find((n) => n.id === german.id)!.asFound).toBe('Johann Nowack');
    const history = History.parse((await call(contributor, 'GET', `/api/history/person/${L.janNovak}`)).json());
    expect(history.items[0]).toMatchObject({ kind: 'direct', author: { displayName: 'Eva Editor' }, acceptedBy: { displayName: 'Eva Editor' } });
    expect(history.items[0]!.citations.length).toBe(1);
  });

  it('Contributors cannot change the Tree directly', async () => {
    expect((await submit(contributor, citation('D'), { direct: true })).statusCode).toBe(403);
  });

  // ---------------------------------------------------------------- 2.1 review queue

  it('the review queue lists pending Proposals oldest first, with author, Agent flag and readable changes', async () => {
    a.clock.advance(MINUTE);
    const res = await call(editor, 'GET', '/api/review');
    expect(res.statusCode).toBe(200);
    const items = ProposalList.parse(res.json()).items;
    expect(items.length).toBeGreaterThanOrEqual(3);
    const times = items.map((p) => p.submittedAt);
    expect(times).toEqual([...times].sort());
    expect(items.every((p) => p.status === 'pending')).toBe(true);
    expect(items[0]!.author).toEqual({ id: contributor.id, displayName: 'Karel Contributor', isAgent: false });
    expect(items[0]!.operations[0]!.summary.en).toBe('adds the Person Ludmila Invented');
    expect(items[0]!.operations[0]!.summary.cs).toBe('přidává osobu: Ludmila Invented');
    expect((await call(contributor, 'GET', '/api/review')).statusCode).toBe(403);
  });

  // ---------------------------------------------------------------- 2.2 accept, correct, reject

  it('accept with a correction: the Tree changes with the corrected year and the history shows the author and the Editor', async () => {
    const ops: OperationInput[] = [
      { op: 'createPerson', tempId: 'tmp:b', sex: 'female', name: { given: 'Barbora', surname: 'Invented', type: 'birth', asFound: 'Barbara' } },
      { op: 'createEvent', tempId: 'tmp:e', type: 'baptism', date: '1831-04-02', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:e', personId: 'tmp:b', role: 'child' },
      ...citation('Y'),
      { op: 'attachCitation', citationId: 'tmp:citY', eventId: 'tmp:e' },
    ];
    const p = ProposalView.parse((await submit(contributor, ops)).json());
    const res = await call(editor, 'POST', `/api/proposals/${p.id}/accept`, { note: 'Year was 1813, see the register', corrections: [{ position: 1, operation: { ...ops[1], date: '1813-04-02' } }] });
    expect(res.statusCode, res.body).toBe(200);
    const accepted = ProposalView.parse(res.json());
    expect(accepted.status).toBe('accepted');
    expect(accepted.operations[1]).toMatchObject({ corrected: true, summary: { en: 'adds the baptism on 1813-04-02 at Kamenná Lhota' }, originalSummary: { en: 'adds the baptism on 1831-04-02 at Kamenná Lhota' } });
    const barbora = await t.db.selectFrom('name').select('person_id').where('as_found', '=', 'Barbara').executeTakeFirstOrThrow();
    const detail = await person(barbora.person_id);
    expect(detail.events[0]!.event.date).toBe('1813-04-02');
    const history = History.parse((await call(contributor, 'GET', `/api/history/person/${barbora.person_id}`)).json()).items;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ author: { displayName: 'Karel Contributor' }, acceptedBy: { displayName: 'Eva Editor' }, decisionNote: 'Year was 1813, see the register' });
    const corrections = history[0]!.corrections;
    expect(corrections.map((c) => ({ position: c.position, by: c.by, summary: c.summary.en, original: c.original.en }))).toEqual([
      { position: 1, by: { id: editor.id, displayName: 'Eva Editor', isAgent: false }, summary: 'adds the baptism on 1813-04-02 at Kamenná Lhota', original: 'adds the baptism on 1831-04-02 at Kamenná Lhota' },
    ]);
  });

  it('reject with a note: nothing in the Tree changes and the author sees the note', async () => {
    const p = ProposalView.parse((await submit(contributor, [{ op: 'createPerson', tempId: 'tmp:z', sex: 'male', name: { given: 'Zikmund', surname: 'Invented', type: 'birth', asFound: 'Sigismundus' } }, ...citation('N')])).json());
    const persons = await count('person');
    const res = await call(editor, 'POST', `/api/proposals/${p.id}/reject`, { note: 'wrong parish, see 1820 register' });
    expect(res.statusCode).toBe(200);
    expect(await count('person')).toBe(persons);
    const mine = ProposalList.parse((await call(contributor, 'GET', '/api/proposals?mine=true')).json()).items.find((x) => x.id === p.id)!;
    expect(mine).toMatchObject({ status: 'rejected', decisionNote: 'wrong parish, see 1820 register', decidedBy: { displayName: 'Eva Editor' } });
    expect((await call(editor, 'POST', `/api/proposals/${p.id}/accept`, {})).statusCode).toBe(409);
  });

  // ---------------------------------------------------------------- 2.3 conflicts

  it('two Proposals for the same date: the Editor sees both values and picks one before the second can be accepted', async () => {
    const death = EventDetail.parse((await call(contributor, 'GET', `/api/events/${L.janDeath}`)).json());
    const change = (date: string, tag: string): OperationInput[] => [...citation(tag), { op: 'setField', record: 'event', id: L.janDeath, baseVersion: death.version, set: { date } }, { op: 'attachCitation', citationId: `tmp:cit${tag}`, eventId: L.janDeath, baseVersion: death.version }];
    const first = ProposalView.parse((await submit(contributor, change('1850-11-04', 'A'))).json());
    const second = ProposalView.parse((await submit(other, change('1850-11-13', 'B'))).json());
    expect((await call(editor, 'POST', `/api/proposals/${first.id}/accept`, {})).statusCode).toBe(200);

    const queued = ProposalView.parse((await call(editor, 'GET', `/api/proposals/${second.id}`)).json());
    expect(queued.conflicts).toBe(2);
    expect(queued.operations[2]!.conflict).toMatchObject({ record: 'event', baseVersion: death.version, currentVersion: death.version + 1, fields: [{ field: 'date', proposed: '1850-11-13', current: '1850-11-04' }] });

    const refused = await call(editor, 'POST', `/api/proposals/${second.id}/accept`, {});
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused).code).toBe('conflict');

    const res = await call(editor, 'POST', `/api/proposals/${second.id}/accept`, { resolutions: [{ position: 2, fields: { date: 'current' } }, { position: 3 }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(EventDetail.parse((await call(contributor, 'GET', `/api/events/${L.janDeath}`)).json()).date).toBe('1850-11-04');
    // The choice is stored as the Editor's correction.
    expect(ProposalView.parse(res.json()).operations[2]).toMatchObject({ corrected: true, operation: { set: {} } });
  });

  // ---------------------------------------------------------------- tree-history: who changed a death date

  it('who changed a death date: the log shows the Proposal, its author, the accepting Editor, the date and the Citation', async () => {
    const history = History.parse((await call(other, 'GET', `/api/history/event/${L.janDeath}`)).json()).items;
    const setter = history.find((h) => h.summaries.some((s) => s.en.includes('“1850-11-04”')))!;
    expect(setter).toMatchObject({ author: { displayName: 'Karel Contributor' }, acceptedBy: { displayName: 'Eva Editor' }, kind: 'contribution' });
    expect(setter.acceptedAt).toBe(a.clock.now().toISOString());
    expect(setter.citations.map(({ id, sourceTitle, page }) => ({ id: /^[0-9a-f-]{36}$/.test(id), sourceTitle, page }))).toEqual([{ id: true, sourceTitle: 'Invented register A', page: '17' }]);
    const change = setter.changes.find((c) => c.table === 'event')!;
    expect([change.before!.date, change.after!.date]).toEqual(['1850-11-03', '1850-11-04']);
  });

  it('the log is append-only', async () => {
    await expect(t.db.updateTable('log_entry').set({ accepted_at: new Date() }).execute()).rejects.toThrow(/append-only/);
    await expect(t.db.deleteFrom('log_change').execute()).rejects.toThrow(/append-only/);
  });

  // ---------------------------------------------------------------- 2.4 merge

  async function sameManTwice(): Promise<{ baptised: string; married: string }> {
    const p = ProposalView.parse(
      (
        await submit(contributor, [
          { op: 'createPerson', tempId: 'tmp:a', sex: 'male', name: { given: 'Matěj', surname: 'Zvonař', type: 'birth', asFound: 'Mathias Zwonarz' } },
          { op: 'createEvent', tempId: 'tmp:bap', type: 'baptism', date: '1812-02-11', placeId: L.kamennaLhota },
          { op: 'addRole', eventId: 'tmp:bap', personId: 'tmp:a', role: 'child' },
          { op: 'createPerson', tempId: 'tmp:b', sex: 'male', name: { given: 'Matěj', surname: 'Zvonař', type: 'birth', asFound: 'Matthäus Zwonař' } },
          { op: 'createEvent', tempId: 'tmp:mar', type: 'marriage', date: '1836-01-20', placeId: L.kamennaLhota },
          { op: 'addRole', eventId: 'tmp:mar', personId: 'tmp:b', role: 'partner' },
          ...citation('M'),
          { op: 'attachCitation', citationId: 'tmp:citM', eventId: 'tmp:bap' },
        ])
      ).json(),
    );
    expect((await call(editor, 'POST', `/api/proposals/${p.id}/accept`, {})).statusCode).toBe(200);
    const ids = await t.db.selectFrom('name').select(['person_id', 'as_found']).where('surname', '=', 'Zvonař').execute();
    return { baptised: ids.find((i) => i.as_found === 'Mathias Zwonarz')!.person_id, married: ids.find((i) => i.as_found === 'Matthäus Zwonař')!.person_id };
  }

  let merge: { proposalId: string; kept: string; gone: string } | undefined;

  it('same man added twice: after the merge one Person remains with both Events, and the other no longer appears in search', async () => {
    const { baptised, married } = await sameManTwice();
    const search = async () => PersonSearchResult.parse((await call(contributor, 'GET', '/api/persons?q=zvonar')).json()).items.map((i) => i.person.id).sort();
    expect(await search()).toEqual([baptised, married].sort());
    const kept = await person(baptised);
    const gone = await person(married);
    const res = await call(editor, 'POST', `/api/persons/${baptised}/merge`, { mergeId: married, keepBaseVersion: kept.version, mergeBaseVersion: gone.version, note: 'Same man: same parents named in both entries' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'direct', status: 'accepted' });
    const after = await person(baptised);
    expect(after.events.map((e) => e.event.type).sort()).toEqual(['baptism', 'marriage']);
    expect(after.names.map((n) => [n.asFound, n.primary])).toEqual([
      ['Mathias Zwonarz', true],
      ['Matthäus Zwonař', false],
    ]);
    expect(await search()).toEqual([baptised]);
    // Old links redirect to the remaining Person.
    const old = await call(contributor, 'GET', `/api/persons/${married}`);
    expect(old.statusCode).toBe(308);
    expect(old.headers.location).toBe(`/api/persons/${baptised}`);
    merge = { proposalId: idOf(res), kept: baptised, gone: married };
  });

  // ---------------------------------------------------------------- 2.5 403

  it('Contributors never accept, reject or merge: the API refuses with 403', async () => {
    const p = ProposalView.parse((await submit(other, citation('X'))).json());
    expect((await call(contributor, 'POST', `/api/proposals/${p.id}/accept`, {})).statusCode).toBe(403);
    expect((await call(contributor, 'POST', `/api/proposals/${p.id}/reject`, { note: 'no' })).statusCode).toBe(403);
    expect((await call(other, 'POST', `/api/proposals/${p.id}/accept`, {})).statusCode).toBe(403);
    const jan = await person(L.janNovak);
    expect((await call(contributor, 'POST', `/api/persons/${L.janNovak}/merge`, { mergeId: L.founder, keepBaseVersion: jan.version, mergeBaseVersion: 1 })).statusCode).toBe(403);
    const sneaky = await submit(contributor, [{ op: 'mergePersons', keepId: L.janNovak, mergeId: L.founder, keepBaseVersion: 1, mergeBaseVersion: 1 }]);
    expect(sneaky.statusCode).toBe(403);
    expect((await call(contributor, 'POST', `/api/proposals/${merge!.proposalId}/undo`, {})).statusCode).toBe(403);
    expect(ProposalView.parse((await call(editor, 'GET', `/api/proposals/${p.id}`)).json()).status).toBe('pending');
  });

  // ---------------------------------------------------------------- 3.1 history

  it('Person history: each accepted change, newest first, with author and date', async () => {
    const res = await call(other, 'GET', `/api/history/person/${merge!.kept}`);
    expect(res.statusCode).toBe(200);
    const items = History.parse(res.json()).items;
    expect(items.map((i) => i.kind)).toEqual(['direct', 'contribution']);
    expect(items[0]!.summaries[0]!.en).toBe('merges Matěj Zvonař (merged Person) into Matěj Zvonař');
    expect(items[1]).toMatchObject({ author: { displayName: 'Karel Contributor' }, acceptedBy: { displayName: 'Eva Editor' } });
    expect(new Date(items[0]!.acceptedAt) >= new Date(items[1]!.acceptedAt)).toBe(true);
  });

  // ---------------------------------------------------------------- 3.2 undo

  it('undo a wrong merge: both Persons exist again with their own Events, and the log shows the undo', async () => {
    const preview = await call(editor, 'GET', `/api/proposals/${merge!.proposalId}/undo`);
    expect(preview.json()).toEqual({ proposalId: merge!.proposalId, laterEdits: [], blockedBy: [] });
    const res = await call(editor, 'POST', `/api/proposals/${merge!.proposalId}/undo`, { note: 'Two different men after all' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'undo', status: 'accepted', undoes: merge!.proposalId });
    const kept = await person(merge!.kept);
    const back = await call(contributor, 'GET', `/api/persons/${merge!.gone}`);
    expect(back.statusCode).toBe(200);
    expect(kept.events.map((e) => e.event.type)).toEqual(['baptism']);
    expect(PersonDetail.parse(back.json()).events.map((e) => e.event.type)).toEqual(['marriage']);
    expect(PersonDetail.parse(back.json()).names.map((n) => [n.asFound, n.primary])).toEqual([['Matthäus Zwonař', true]]);
    const history = History.parse((await call(other, 'GET', `/api/history/person/${merge!.gone}`)).json()).items;
    expect(history.map((h) => h.kind)).toEqual(['undo', 'direct', 'contribution']);
    expect(history[1]!.undoneBy).toBe(idOf(res));
    expect((await call(editor, 'POST', `/api/proposals/${merge!.proposalId}/undo`, {})).statusCode).toBe(409);
  });

  it('undo after later edits: the Editor sees the later edits and chooses for each field before the undo completes', async () => {
    const p = ProposalView.parse(
      (
        await submit(contributor, [
          { op: 'createPerson', tempId: 'tmp:v', sex: 'unknown', name: { given: 'Věnceslava', surname: 'Invented', type: 'birth', asFound: 'Wenceslava' } },
          { op: 'createEvent', tempId: 'tmp:d', type: 'death', date: '1870', placeId: L.kamennaLhota },
          { op: 'addRole', eventId: 'tmp:d', personId: 'tmp:v', role: 'deceased' },
          ...citation('U'),
          { op: 'attachCitation', citationId: 'tmp:citU', eventId: 'tmp:d' },
        ])
      ).json(),
    );
    await call(editor, 'POST', `/api/proposals/${p.id}/accept`, {});
    const name = await t.db.selectFrom('name').selectAll().where('as_found', '=', 'Wenceslava').executeTakeFirstOrThrow();
    const v = await person(name.person_id);
    // A first Proposal sets the sex and the surname …
    const fix = ProposalView.parse(
      (
        await submit(editor, [...citation('V'), { op: 'setField', record: 'person', id: v.id, baseVersion: v.version, set: { sex: 'female' } }, { op: 'setField', record: 'name', id: name.id, baseVersion: name.version, set: { surname: 'Invented-Nová' } }, { op: 'attachCitation', citationId: 'tmp:citV', nameId: name.id, baseVersion: name.version }], { direct: true })
      ).json(),
    );
    // … and a later one edits the surname again.
    const later = await person(v.id);
    const latestName = later.names[0]!;
    expect((await submit(editor, [...citation('W'), { op: 'setField', record: 'name', id: name.id, baseVersion: latestName.version, set: { surname: 'Nová', given: 'Venceslava' } }, { op: 'attachCitation', citationId: 'tmp:citW', nameId: name.id, baseVersion: latestName.version }], { direct: true })).statusCode).toBe(201);

    const preview = UndoPreview.parse((await call(editor, 'GET', `/api/proposals/${fix.id}/undo`)).json());
    expect(preview.laterEdits).toEqual([
      expect.objectContaining({ table: 'name', id: name.id, recordLevel: false, fields: [{ field: 'given', before: 'Věnceslava', after: 'Věnceslava', current: 'Venceslava' }, { field: 'surname', before: 'Invented', after: 'Invented-Nová', current: 'Nová' }] }),
    ]);
    const refused = await call(editor, 'POST', `/api/proposals/${fix.id}/undo`, {});
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused).code).toBe('later_edits');
    expect((await person(v.id)).sex).toBe('female');

    const res = await call(editor, 'POST', `/api/proposals/${fix.id}/undo`, { choices: [{ table: 'name', id: name.id, fields: { given: 'keep', surname: 'undo' } }] });
    expect(res.statusCode, res.body).toBe(200);
    const undone = await person(v.id);
    expect(undone.sex).toBe('unknown');
    expect(undone.names[0]).toMatchObject({ given: 'Venceslava', surname: 'Invented' });
  });

  // ---------------------------------------------------------------- review findings

  it('undo is refused while later accepted Proposals attach records to ones it would remove; undoing those first, newest first, works', async () => {
    const x = ProposalView.parse(
      (
        await submit(contributor, [
          { op: 'createPerson', tempId: 'tmp:p', sex: 'male', name: { given: 'Prokop', surname: 'Invented', type: 'birth', asFound: 'Procopius' } },
          { op: 'createEvent', tempId: 'tmp:e', type: 'baptism', date: '1828-07-04', placeId: L.kamennaLhota },
          { op: 'addRole', eventId: 'tmp:e', personId: 'tmp:p', role: 'child' },
          ...citation('X1'),
          { op: 'attachCitation', citationId: 'tmp:citX1', eventId: 'tmp:e' },
        ])
      ).json(),
    );
    expect((await call(editor, 'POST', `/api/proposals/${x.id}/accept`, {})).statusCode).toBe(200);
    const prokop = (await t.db.selectFrom('name').select('person_id').where('as_found', '=', 'Procopius').executeTakeFirstOrThrow()).person_id;
    const p = await person(prokop);
    const death = EventDetail.parse((await call(contributor, 'GET', `/api/events/${L.janDeath}`)).json());
    const family = FamilyDetail.parse((await call(contributor, 'GET', `/api/families/${L.janFirstFamily}`)).json());
    // Y attaches a Name, a Role and a child link to the Person X created. None of them changes the Person's version.
    const y = ProposalView.parse(
      (
        await submit(other, [
          ...citation('Y1'),
          { op: 'addName', personId: prokop, baseVersion: p.version, given: 'Procopius', surname: 'Invented', type: 'latin', asFound: 'Procopius Inventus' },
          { op: 'addRole', eventId: L.janDeath, personId: prokop, role: 'witness', baseVersion: death.version },
          { op: 'linkChild', familyId: L.janFirstFamily, childId: prokop, linkType: 'foster', baseVersion: family.version },
          { op: 'attachCitation', citationId: 'tmp:citY1', eventId: L.janDeath, baseVersion: death.version },
        ])
      ).json(),
    );
    expect((await call(editor, 'POST', `/api/proposals/${y.id}/accept`, {})).statusCode).toBe(200);
    expect((await call(editor, 'GET', `/api/proposals/${x.id}/undo`)).json()).toMatchObject({ laterEdits: [], blockedBy: [y.id] });

    const before = { person: await person(prokop), log: await count('log_entry') };
    const refused = await call(editor, 'POST', `/api/proposals/${x.id}/undo`, {});
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused).code).toBe('undo_blocked_by_dependents');
    expect(errorOf(refused).message).toContain(y.id);
    expect(await person(prokop)).toEqual(before.person);
    expect(await count('log_entry')).toBe(before.log);
    expect(EventDetail.parse((await call(contributor, 'GET', `/api/events/${L.janDeath}`)).json()).roles.some((r) => r.person.id === prokop)).toBe(true);

    expect((await call(editor, 'POST', `/api/proposals/${y.id}/undo`, {})).statusCode).toBe(200);
    expect((await call(editor, 'POST', `/api/proposals/${x.id}/undo`, {})).statusCode).toBe(200);
    expect((await call(contributor, 'GET', `/api/persons/${prokop}`)).statusCode).toBe(404);
    expect(FamilyDetail.parse((await call(contributor, 'GET', `/api/families/${L.janFirstFamily}`)).json()).children.map((c) => c.person.id)).not.toContain(prokop);
  });

  it('undoing an undo puts the Proposal back in force, and it can be undone again; merged ids redirect on every Person route', async () => {
    const original = ProposalView.parse((await call(editor, 'GET', `/api/proposals/${merge!.proposalId}`)).json());
    expect(original.undoneBy).not.toBeNull();
    const redo = await call(editor, 'POST', `/api/proposals/${original.undoneBy}/undo`, {});
    expect(redo.statusCode, redo.body).toBe(200);
    expect(ProposalView.parse((await call(editor, 'GET', `/api/proposals/${merge!.proposalId}`)).json()).undoneBy).toBeNull();
    // Merged again: the old id redirects on every Person route.
    for (const sub of ['', '/ancestors?generations=3', '/descendants']) {
      const res = await call(contributor, 'GET', `/api/persons/${merge!.gone}${sub}`);
      expect(res.statusCode).toBe(308);
      expect(res.headers.location).toBe(`/api/persons/${merge!.kept}${sub}`);
    }
    // A merged Person cannot be cited as the giver of a Family account.
    const fa = ProposalView.parse(
      (
        await submit(contributor, [
          { op: 'createSource', tempId: 'tmp:fa', type: 'family_account', title: 'Invented account', familyAccount: { givenBy: 'Matěj', givenByPersonId: merge!.gone, givenOn: '1880' } },
          { op: 'createCitation', tempId: 'tmp:c', sourceId: 'tmp:fa', transcription: 'Invented.', readOn: '2026-10-01', confidence: 'low' },
        ])
      ).json(),
    );
    const accept = await call(editor, 'POST', `/api/proposals/${fa.id}/accept`, {});
    expect(accept.statusCode).toBe(409);
    expect(errorOf(accept).code).toBe('person_merged');
    expect((await call(editor, 'POST', `/api/proposals/${merge!.proposalId}/undo`, {})).statusCode).toBe(200);
    expect((await call(contributor, 'GET', `/api/persons/${merge!.gone}`)).statusCode).toBe(200);
  });

  it('a field name from Object.prototype is a 400, not a crash', async () => {
    const jan = await person(L.janNovak);
    for (const key of ['constructor', 'toString']) {
      const res = await submit(editor, [...citation('Q'), { op: 'setField', record: 'name', id: jan.names[0]!.id, baseVersion: jan.names[0]!.version, set: { [key]: 'x' } }]);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).message).toContain(`no settable field "${key}"`);
    }
  });
});
