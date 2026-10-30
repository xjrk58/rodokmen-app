import { EventDetail, History, ProposalList, ProposalView, type OperationInput } from '@rodokmen/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import type { TestDatabase } from './db.js';
import { errorOf, idOf, MINUTE } from './helpers.js';
import type { TestApp } from './helpers.js';
import { citation, newKey, useProposalTestbed } from './proposal-testbed.js';

const L = generateFixture().landmarks;

describe('Proposals, review and history', () => {
  const { ready, call, submit, person, count } = useProposalTestbed();
  let t: TestDatabase;
  let a: TestApp;
  let owner: Account;
  let editor: Account;
  let contributor: Account;
  let other: Account;
  beforeAll(() => ({ t, a, owner, editor, contributor, other } = ready()));

  // ---------------------------------------------------------------- 1.2 evidence rule

  it('a Proposal without any Citation is refused and asks for the register entry, a document or a Family account', async () => {
    const res = await submit(contributor, [
      { op: 'createPerson', tempId: 'tmp:p', sex: 'female', name: { given: 'Ludmila', surname: 'Invented', type: 'birth', asFound: 'Ludmila Invented' } },
    ]);
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('evidence_missing');
    // In the author's language (Czech here).
    expect(errorOf(res).message).toMatch(/zápis z matriky, dokument nebo rodinné vyprávění/);
  });

  it('a Proposal citing a Family account is accepted for review', async () => {
    const res = await submit(contributor, [
      { op: 'createPerson', tempId: 'tmp:p', sex: 'female', name: { given: 'Ludmila', surname: 'Invented', type: 'birth', asFound: 'Ludmila Invented' } },
      {
        op: 'createSource',
        tempId: 'tmp:fa',
        type: 'family_account',
        title: 'What grandmother remembers (invented)',
        familyAccount: { givenBy: 'Invented aunt', givenByPersonId: null, givenOn: '2026-05' },
      },
      { op: 'createCitation', tempId: 'tmp:c', sourceId: 'tmp:fa', transcription: 'She was called Lída at home.', readOn: '2026-05-10', confidence: 'low' },
    ]);
    expect(res.statusCode).toBe(201);
    const p = ProposalView.parse(res.json());
    expect(p.status).toBe('pending');
    expect(p.citations[0]).toMatchObject({ sourceType: 'family_account', transcription: 'She was called Lída at home.' });
  });

  it('a retried submit with the same idempotency key creates one Proposal', async () => {
    const body = {
      formatVersion: 1,
      idempotencyKey: newKey(),
      note: 'retry',
      operations: [...citation('R'), { op: 'attachCitation', citationId: 'tmp:citR', eventId: L.janDeath, baseVersion: 1 }],
    };
    const before = await count('proposal');
    const first = await call(contributor, 'POST', '/api/proposals', body);
    const second = await call(contributor, 'POST', '/api/proposals', body);
    expect([first.statusCode, second.statusCode]).toEqual([201, 200]);
    expect(idOf(second)).toBe(idOf(first));
    expect(await count('proposal')).toBe(before + 1);
  });

  it('pending Proposals stay private: other Contributors see the Person as accepted so far and cannot open the Proposal', async () => {
    const jan = await person(L.janNovak);
    const res = await submit(contributor, [
      ...citation('P'),
      { op: 'addName', personId: L.janNovak, baseVersion: jan.version, given: 'Johannes', surname: 'Nowack', type: 'german', asFound: 'Johannes Nowack' },
    ]);
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
    const counts = {
      persons: await count('person'),
      names: await count('name'),
      events: await count('event'),
      roles: await count('event_role'),
      log: await count('log_entry'),
    };
    const accept = await call(editor, 'POST', `/api/proposals/${idOf(res)}/accept`, {});
    expect(accept.statusCode).toBe(409);
    expect(errorOf(accept).message).toMatch(/Operation 7/);
    expect({
      persons: await count('person'),
      names: await count('name'),
      events: await count('event'),
      roles: await count('event_role'),
      log: await count('log_entry'),
    }).toEqual(counts);
    expect(ProposalView.parse((await call(editor, 'GET', `/api/proposals/${idOf(res)}`)).json()).status).toBe('pending');
  });

  it('a rule checked at commit (one primary Name) also rolls everything back', async () => {
    const jan = await person(L.janNovak);
    const latin = jan.names.find((n) => n.type === 'latin')!;
    // The database refuses a Name with neither given name nor surname only at the end.
    const res = await submit(
      editor,
      [
        ...citation('C'),
        { op: 'createPerson', tempId: 'tmp:x', sex: 'male', name: { given: 'Ondřej', surname: 'Invented', type: 'birth', asFound: 'Ondřej' } },
        { op: 'setField', record: 'name', id: latin.id, baseVersion: latin.version, set: { given: '', surname: '' } },
      ],
      { direct: true },
    );
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
    const res = await call(editor, 'POST', `/api/proposals/${p.id}/accept`, {
      note: 'Year was 1813, see the register',
      corrections: [{ position: 1, operation: { ...ops[1], date: '1813-04-02' } }],
    });
    expect(res.statusCode, res.body).toBe(200);
    const accepted = ProposalView.parse(res.json());
    expect(accepted.status).toBe('accepted');
    expect(accepted.operations[1]).toMatchObject({
      corrected: true,
      summary: { en: 'adds the baptism on 1813-04-02 at Kamenná Lhota' },
      originalSummary: { en: 'adds the baptism on 1831-04-02 at Kamenná Lhota' },
    });
    const barbora = await t.db.selectFrom('name').select('person_id').where('as_found', '=', 'Barbara').executeTakeFirstOrThrow();
    const detail = await person(barbora.person_id);
    expect(detail.events[0]!.event.date).toBe('1813-04-02');
    const history = History.parse((await call(contributor, 'GET', `/api/history/person/${barbora.person_id}`)).json()).items;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      author: { displayName: 'Karel Contributor' },
      acceptedBy: { displayName: 'Eva Editor' },
      decisionNote: 'Year was 1813, see the register',
    });
    const corrections = history[0]!.corrections;
    expect(corrections.map((c) => ({ position: c.position, by: c.by, summary: c.summary.en, original: c.original.en }))).toEqual([
      {
        position: 1,
        by: { id: editor.id, displayName: 'Eva Editor', isAgent: false },
        summary: 'adds the baptism on 1813-04-02 at Kamenná Lhota',
        original: 'adds the baptism on 1831-04-02 at Kamenná Lhota',
      },
    ]);
  });

  it('reject with a note: nothing in the Tree changes and the author sees the note', async () => {
    const p = ProposalView.parse(
      (
        await submit(contributor, [
          { op: 'createPerson', tempId: 'tmp:z', sex: 'male', name: { given: 'Zikmund', surname: 'Invented', type: 'birth', asFound: 'Sigismundus' } },
          ...citation('N'),
        ])
      ).json(),
    );
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
    const change = (date: string, tag: string): OperationInput[] => [
      ...citation(tag),
      { op: 'setField', record: 'event', id: L.janDeath, baseVersion: death.version, set: { date } },
      { op: 'attachCitation', citationId: `tmp:cit${tag}`, eventId: L.janDeath, baseVersion: death.version },
    ];
    const first = ProposalView.parse((await submit(contributor, change('1850-11-04', 'A'))).json());
    const second = ProposalView.parse((await submit(other, change('1850-11-13', 'B'))).json());
    expect((await call(editor, 'POST', `/api/proposals/${first.id}/accept`, {})).statusCode).toBe(200);

    const queued = ProposalView.parse((await call(editor, 'GET', `/api/proposals/${second.id}`)).json());
    expect(queued.conflicts).toBe(2);
    expect(queued.operations[2]!.conflict).toMatchObject({
      record: 'event',
      baseVersion: death.version,
      currentVersion: death.version + 1,
      fields: [{ field: 'date', proposed: '1850-11-13', current: '1850-11-04' }],
    });

    const refused = await call(editor, 'POST', `/api/proposals/${second.id}/accept`, {});
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused).code).toBe('conflict');

    const res = await call(editor, 'POST', `/api/proposals/${second.id}/accept`, {
      resolutions: [{ position: 2, fields: { date: 'current' } }, { position: 3 }],
    });
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
    expect(setter.citations.map(({ id, sourceTitle, page }) => ({ id: /^[0-9a-f-]{36}$/.test(id), sourceTitle, page }))).toEqual([
      { id: true, sourceTitle: 'Invented register A', page: '17' },
    ]);
    const change = setter.changes.find((c) => c.table === 'event')!;
    expect([change.before!.date, change.after!.date]).toEqual(['1850-11-03', '1850-11-04']);
  });

  it('the log is append-only', async () => {
    await expect(t.db.updateTable('log_entry').set({ accepted_at: new Date() }).execute()).rejects.toThrow(/append-only/);
    await expect(t.db.deleteFrom('log_change').execute()).rejects.toThrow(/append-only/);
  });
});
