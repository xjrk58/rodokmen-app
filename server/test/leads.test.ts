import { LeadDetail, LeadList, ProposalView, type OperationInput } from '@rodokmen/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { eraseFromLeads } from '../src/leads/erasure.js';
import { leadsForExport } from '../src/leads/export.js';
import { SEARCH_NEEDED } from '../src/leads/service.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { bearer, createAgentWithToken, createMember, ensureOwner, errorOf, makeApp, signIn, type TestApp } from './helpers.js';
import { citation, newKey } from './proposal-testbed.js';

const L = generateFixture().landmarks;
const UNKNOWN = '0192f0c4-7a1e-7c3b-9d2a-00000000beef';

/**
 * Research leads through the API (research-leads spec; agent-access spec, "Agents write Research
 * leads"), on a fresh copy of the fixture Tree.
 */
describe('Research leads', () => {
  let t: TestDatabase;
  let a: TestApp;
  let owner: Account;
  let editor: Account;
  let contributor: Account;
  let other: Account;
  let agent: Account;
  let token: string;
  /** The fixture's birth register of the Parish of Kamenná Lhota, 1784–1830. */
  let register: string;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    owner = await ensureOwner(t.db);
    editor = await createMember(t.db, 'editor', { displayName: 'Eva Editor' });
    contributor = await createMember(t.db, 'contributor', { displayName: 'Karel Contributor' });
    other = await createMember(t.db, 'contributor', { displayName: 'Olga Other' });
    for (const m of [owner, editor, contributor, other]) cookies.set(m.id, await signIn(t.db, a.clock, m));
    ({ agent, token } = await createAgentWithToken(t.db, a.clock, 'Register reader'));
    register = (
      await t.db
        .selectFrom('source')
        .select('id')
        .where('register_parish_id', '=', L.parishDolniKamenec)
        .where(sql<boolean>`'birth' = any(register_kinds)`)
        .where('register_from', '=', 1784)
        .executeTakeFirstOrThrow()
    ).id;
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  type Method = 'GET' | 'POST' | 'PATCH';
  const call = (m: Account | 'agent', method: Method, url: string, payload?: object) =>
    a.app.inject({
      method,
      url,
      headers: m === 'agent' ? bearer(token) : { cookie: cookies.get(m.id)! },
      ...(payload === undefined ? {} : { payload }),
    });
  const lead = async (m: Account | 'agent', method: Method, url: string, payload?: object, status = 200) => {
    const res = await call(m, method, url, payload);
    expect(res.statusCode, res.body).toBe(status);
    return LeadDetail.parse(res.json());
  };
  const write = (m: Account | 'agent', body: object) => lead(m, 'POST', '/api/leads', body, 201);
  const list = async (query = '', m: Account = other) => LeadList.parse((await call(m, 'GET', `/api/leads${query}`)).json());
  const count = async (table: 'proposal' | 'lead' | 'log_entry') =>
    (
      await t.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow()
    ).n;

  const JANS_BAPTISM = 'Find Jan’s baptism: born about 1801 in Dolní Lhota, check N Horní Lhota 1784–1820';

  it('writing a lead: the question, the register, the years and Jan linked, with status open', async () => {
    const l = await write(contributor, {
      question: JANS_BAPTISM,
      reason: 'He married in 1825 at about 24; no baptism is cited yet.',
      sourceId: register,
      years: { from: 1784, to: 1820 },
      personIds: [L.janNovak],
      placeIds: [L.kamennaLhota],
    });
    expect(l).toMatchObject({
      question: JANS_BAPTISM,
      status: 'open',
      years: { from: 1784, to: 1820 },
      source: { id: register, repository: 'Invented Regional Archive (fixture)' },
      foundBy: null,
      searches: [],
    });
    expect(l.persons.map((p) => p.id)).toEqual([L.janNovak]);
    expect(l.places.map((p) => p.id)).toEqual([L.kamennaLhota]);
  });

  it('contributor adds a lead: every Member sees it at once, with the Contributor as its author, and nothing goes to review', async () => {
    const proposals = await count('proposal');
    const logged = await count('log_entry');
    const l = await write(contributor, { question: 'Who were the godparents of Anna?', reason: 'Not in the transcription.' });
    expect(l.author).toEqual({ id: contributor.id, displayName: 'Karel Contributor', isAgent: false });
    for (const m of [other, editor, owner]) expect((await list('', m)).items.map((x) => x.id)).toContain(l.id);
    expect((await lead(other, 'GET', `/api/leads/${l.id}`)).history).toMatchObject([{ kind: 'created', author: { id: contributor.id } }]);
    expect(await count('proposal')).toBe(proposals);
    expect(await count('log_entry')).toBe(logged);
  });

  it('a lead needs a question and its reason, and refers only to records that exist', async () => {
    expect((await call(contributor, 'POST', '/api/leads', { question: 'Q', reason: ' ' })).statusCode).toBe(400);
    for (const bad of [{ personIds: [UNKNOWN] }, { placeIds: [UNKNOWN] }, { sourceId: UNKNOWN }, { assigneeId: UNKNOWN }]) {
      const res = await call(contributor, 'POST', '/api/leads', { question: 'Q', reason: 'R', ...bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(errorOf(res).code).toBe('unknown_record');
    }
  });

  it('edits are written at once against the version seen, and kept in the history with author and time', async () => {
    const l = await write(contributor, { question: 'Find the marriage', reason: 'Children from 1830 on.' });
    const edited = await lead(other, 'PATCH', `/api/leads/${l.id}`, { baseVersion: l.version, status: 'in_progress', assigneeId: other.id, pages: '40–80' });
    expect(edited).toMatchObject({ status: 'in_progress', pages: '40–80', assignee: { id: other.id }, version: l.version + 1 });
    expect(edited.history[0]).toMatchObject({ kind: 'edited', author: { id: other.id } });
    expect(edited.history[0]!.fields.map((f) => f.field).sort()).toEqual(['assigneeId', 'pages', 'status']);
    // Written by someone who saw the old version: refused, nothing changes.
    const stale = await call(contributor, 'PATCH', `/api/leads/${l.id}`, { baseVersion: l.version, pages: '1–10' });
    expect(stale.statusCode).toBe(409);
    expect((await lead(contributor, 'GET', `/api/leads/${l.id}`)).pages).toBe('40–80');
  });

  it('negative result: closing as not found needs a search record; the lead then shows that search to anyone', async () => {
    const l = await write(contributor, {
      question: 'Find the baptism of Matěj',
      reason: 'Born about 1801.',
      sourceId: register,
      personIds: [L.janNovak],
    });
    const refused = await call(contributor, 'POST', `/api/leads/${l.id}/close`, { baseVersion: l.version, status: 'not_found' });
    expect(refused.statusCode).toBe(400);
    expect(errorOf(refused)).toMatchObject({ code: 'search_needed', message: SEARCH_NEEDED });
    expect((await call(contributor, 'PATCH', `/api/leads/${l.id}`, { baseVersion: l.version, status: 'not_found' })).statusCode).toBe(400);
    expect((await lead(contributor, 'GET', `/api/leads/${l.id}`)).status).toBe('open');

    const closed = await lead(contributor, 'POST', `/api/leads/${l.id}/close`, {
      baseVersion: l.version,
      status: 'not_found',
      outcome: 'Not in the register for those years.',
      search: { sourceId: register, years: { from: 1798, to: 1805 }, pages: '1–60', found: false, note: 'No Matěj among the boys baptised.' },
    });
    expect(closed).toMatchObject({ status: 'not_found', outcome: 'Not in the register for those years.' });
    expect(closed.searches).toMatchObject([
      {
        source: { id: register },
        years: { from: 1798, to: 1805 },
        pages: '1–60',
        found: false,
        searchedOn: '2026-10-29',
        searchedBy: 'Karel Contributor',
        author: { id: contributor.id },
      },
    ]);
    expect(closed.history.map((h) => h.kind)).toEqual(['closed', 'searched', 'created']);
    // Someone planning the same search finds it done, on the leads of that Person.
    const planned = (await list(`?personId=${L.janNovak}`, other)).items.find((x) => x.id === l.id)!;
    expect(planned.searches[0]).toMatchObject({ source: { id: register }, years: { from: 1798, to: 1805 }, pages: '1–60' });
  });

  it('a lead may start closed as not found when it brings the search that found nothing', async () => {
    expect((await call(contributor, 'POST', '/api/leads', { question: 'Q', reason: 'R', status: 'not_found' })).statusCode).toBe(400);
    const l = await write(contributor, {
      question: 'Find the burial',
      reason: 'Died 1850.',
      status: 'not_found',
      searches: [
        {
          archive: 'Invented archive',
          years: { from: 1850, to: 1851 },
          pages: 'all',
          searchedOn: '2024-03',
          searchedBy: 'An invented researcher',
          found: false,
        },
      ],
    });
    expect(l.searches).toMatchObject([{ archive: 'Invented archive', searchedOn: '2024-03', searchedBy: 'An invented researcher', source: null }]);
    expect((await call(contributor, 'POST', `/api/leads/${l.id}/searches`, { found: false })).statusCode).toBe(400);
  });

  it('the list filters by status, Person, Place, archive and who is working on it', async () => {
    const mine = await write(editor, {
      question: 'Find the house number in 1840',
      reason: 'Census of 1843 may say.',
      archive: 'Státní oblastní archiv (invented)',
      placeIds: [L.vrbice],
      assigneeId: editor.id,
      status: 'in_progress',
    });
    expect((await list(`?placeId=${L.vrbice}`)).items.map((x) => x.id)).toEqual([mine.id]);
    expect((await list(`?assigneeId=${editor.id}`)).items.map((x) => x.id)).toEqual([mine.id]);
    expect((await list('?archive=statni oblastni')).items.map((x) => x.id)).toEqual([mine.id]);
    // The archive of a lead's register counts too.
    expect((await list('?archive=Invented Regional')).items.length).toBeGreaterThanOrEqual(2);
    const progressing = await list('?status=in_progress,found');
    expect(progressing.items.every((x) => x.status === 'in_progress' || x.status === 'found')).toBe(true);
    expect(progressing.items.map((x) => x.id)).toContain(mine.id);
    const all = await list('?limit=200');
    expect(all.total).toBe(all.items.length);
    const firstClosed = all.items.findIndex((x) => x.status === 'found' || x.status === 'not_found');
    expect(all.items.slice(firstClosed).every((x) => x.status === 'found' || x.status === 'not_found')).toBe(true);
    expect((await call(other, 'GET', '/api/leads?status=closed')).statusCode).toBe(400);
  });

  describe('findings link back to leads', () => {
    const baptism = (given: string): OperationInput[] => [
      { op: 'createPerson', tempId: 'tmp:p', sex: 'male', name: { given, surname: 'Invented', type: 'birth', asFound: given } },
      { op: 'createEvent', tempId: 'tmp:e', type: 'baptism', date: '1801-03-12', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:e', personId: 'tmp:p', role: 'child' },
      ...citation(given),
      { op: 'attachCitation', citationId: `tmp:cit${given}`, eventId: 'tmp:e' },
    ];
    const submit = async (m: Account, ops: OperationInput[], extra: object = {}) => {
      const res = await call(m, 'POST', '/api/proposals', { formatVersion: 1, idempotencyKey: newKey(), note: null, operations: ops, ...extra });
      expect(res.statusCode, res.body).toBe(201);
      return ProposalView.parse(res.json());
    };

    it('lead answered: accepting the baptism Proposal that names the lead marks it found, with a link to the Proposal; undo reopens it', async () => {
      const l = await write(contributor, { question: 'Find Jan’s baptism (answered)', reason: 'Born about 1801.' });
      const p = await submit(contributor, baptism('Joannes'), { answersLeads: [l.id] });
      expect(p.answersLeads).toEqual([{ id: l.id, question: 'Find Jan’s baptism (answered)', status: 'open' }]);
      expect((await lead(other, 'GET', `/api/leads/${l.id}`)).status).toBe('open');

      const accepted = ProposalView.parse((await call(editor, 'POST', `/api/proposals/${p.id}/accept`, {})).json());
      expect(accepted.answersLeads[0]!.status).toBe('found');
      const found = await lead(other, 'GET', `/api/leads/${l.id}`);
      expect(found).toMatchObject({ status: 'found', foundBy: p.id });
      expect(found.history[0]).toMatchObject({ kind: 'answered', proposalId: p.id, author: { id: editor.id } });

      const undo = ProposalView.parse((await call(editor, 'POST', `/api/proposals/${p.id}/undo`, { choices: [], note: null })).json());
      const reopened = await lead(other, 'GET', `/api/leads/${l.id}`);
      expect(reopened).toMatchObject({ status: 'open', foundBy: null });
      expect(reopened.history[0]).toMatchObject({ kind: 'reopened', proposalId: p.id });

      // Undoing the undo puts the finding back in force, and the lead is found again.
      expect((await call(editor, 'POST', `/api/proposals/${undo.id}/undo`, { choices: [], note: null })).statusCode).toBe(200);
      expect(await lead(other, 'GET', `/api/leads/${l.id}`)).toMatchObject({ status: 'found', foundBy: p.id });
    });

    it('a rejected Proposal leaves its leads as they were', async () => {
      const l = await write(contributor, { question: 'Find the baptism (rejected)', reason: 'R', status: 'in_progress' });
      const p = await submit(contributor, baptism('Wenceslaus'), { answersLeads: [l.id] });
      expect((await call(editor, 'POST', `/api/proposals/${p.id}/reject`, { note: 'wrong parish' })).statusCode).toBe(200);
      const after = await lead(other, 'GET', `/api/leads/${l.id}`);
      expect(after).toMatchObject({ status: 'in_progress', foundBy: null, version: l.version });
    });

    it('a direct change answers its leads at once; a lead found by hand is not reopened by an undo', async () => {
      const answered = await write(editor, { question: 'Direct', reason: 'R' });
      const byHand = await write(editor, { question: 'By hand', reason: 'R', status: 'found' });
      const p = await submit(editor, baptism('Laurentius'), { direct: true, answersLeads: [answered.id] });
      expect(p.status).toBe('accepted');
      expect(await lead(other, 'GET', `/api/leads/${answered.id}`)).toMatchObject({ status: 'found', foundBy: p.id });
      await call(editor, 'POST', `/api/proposals/${p.id}/undo`, { choices: [], note: null });
      expect((await lead(other, 'GET', `/api/leads/${answered.id}`)).status).toBe('open');
      expect(await lead(other, 'GET', `/api/leads/${byHand.id}`)).toMatchObject({ status: 'found', version: byHand.version });
    });

    it('a Proposal naming a lead that does not exist is refused, and nothing is stored', async () => {
      const before = await count('proposal');
      const res = await call(contributor, 'POST', '/api/proposals', {
        formatVersion: 1,
        idempotencyKey: newKey(),
        note: null,
        operations: baptism('Nemo'),
        answersLeads: [UNKNOWN],
      });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('unknown_lead');
      expect(await count('proposal')).toBe(before);
    });
  });

  describe('Agents write Research leads', () => {
    it('agent records a negative search: it closes the lead as not found with a search record, and the lead shows the Agent as author', async () => {
      const l = await write('agent', { question: 'Find the baptism of Rozálie', reason: 'Godmother in 1840; age unknown.', personIds: [L.janNovak] });
      expect(l.author).toEqual({ id: agent.id, displayName: 'Register reader', isAgent: true });
      const closed = await lead('agent', 'POST', `/api/leads/${l.id}/close`, {
        baseVersion: l.version,
        status: 'not_found',
        search: { sourceId: register, years: { from: 1810, to: 1825 }, pages: '1–90', found: false },
      });
      expect(closed).toMatchObject({ status: 'not_found', author: { isAgent: true } });
      expect(closed.searches[0]).toMatchObject({ searchedBy: 'Register reader', author: { id: agent.id, isAgent: true } });
      expect(closed.history.every((h) => h.author.id === agent.id)).toBe(true);
    });

    it('an Agent edits and adds search records, but never decides on a suggested lead nor touches the Tree directly', async () => {
      const l = await write(contributor, { question: 'For the Agent', reason: 'R' });
      expect((await lead('agent', 'PATCH', `/api/leads/${l.id}`, { baseVersion: l.version, assigneeId: agent.id })).assignee?.isAgent).toBe(true);
      expect((await call('agent', 'POST', `/api/leads/${l.id}/searches`, { archive: 'Invented archive', found: false })).statusCode).toBe(201);
      for (const url of [`/api/lead-suggestions/${UNKNOWN}/accept`, `/api/lead-suggestions/${UNKNOWN}/dismiss`, `/api/proposals/${UNKNOWN}/accept`]) {
        expect((await call('agent', 'POST', url, {})).statusCode, url).toBe(403);
      }
    });
  });

  it('a lead about a Person merged into another shows, and is found under, the Person kept', async () => {
    const l = await write(contributor, { question: 'Merged', reason: 'R', personIds: [L.adoptedChild] });
    const merged = await call(editor, 'POST', `/api/persons/${L.janNovak}/merge`, {
      mergeId: L.adoptedChild,
      keepBaseVersion: (await t.db.selectFrom('person').select('version').where('id', '=', L.janNovak).executeTakeFirstOrThrow()).version,
      mergeBaseVersion: (await t.db.selectFrom('person').select('version').where('id', '=', L.adoptedChild).executeTakeFirstOrThrow()).version,
      note: null,
    });
    expect(merged.statusCode, merged.body).toBe(200);
    expect((await lead(other, 'GET', `/api/leads/${l.id}`)).persons.map((p) => p.id)).toEqual([L.janNovak]);
    expect((await list(`?personId=${L.janNovak}&limit=200`)).items.map((x) => x.id)).toContain(l.id);
    // Undo the merge for the tests that follow.
    const mergeProposal = ProposalView.parse(merged.json());
    expect((await call(editor, 'POST', `/api/proposals/${mergeProposal.id}/undo`, { choices: [], note: null })).statusCode).toBe(200);
  });

  describe('Living people in Exports and on erasure (task 1.4: the rule and its entry; the Export and erasure come with add-exports-and-erasure)', () => {
    it('an Export keeps no link to a Living person, and leaves out a lead about Living people only', async () => {
      const living = await t.db.selectFrom('person').select('id').where('id', '=', L.undated).executeTakeFirstOrThrow();
      const both = await write(contributor, { question: 'Living and not', reason: 'R', personIds: [living.id, L.janNovak] });
      const onlyLiving = await write(contributor, { question: 'Living only', reason: 'R', personIds: [living.id] });
      const exported = await leadsForExport(t.db, a.clock);
      const kept = exported.find((x) => x.id === both.id)!;
      expect(kept.persons.map((p) => p.id)).toEqual([L.janNovak]);
      expect(exported.map((x) => x.id)).not.toContain(onlyLiving.id);
      expect(exported.flatMap((x) => x.persons).every((p) => !p.living)).toBe(true);
    });

    it('erasing a Living person deletes the lead that concerned only them and unlinks them from the others', async () => {
      const living = L.undated;
      const both = await write(contributor, { question: 'Erasure, both', reason: 'R', personIds: [living, L.janNovak] });
      const only = await write(contributor, { question: 'Erasure, only', reason: 'R', personIds: [living] });
      const result = await t.db.transaction().execute((tx) => eraseFromLeads(tx, living));
      expect(result.deleted).toBeGreaterThanOrEqual(1);
      expect((await call(other, 'GET', `/api/leads/${only.id}`)).statusCode).toBe(404);
      const after = await lead(other, 'GET', `/api/leads/${both.id}`);
      expect(after.persons.map((p) => p.id)).toEqual([L.janNovak]);
      expect(JSON.stringify(after.history)).not.toContain(living);
    });
  });
});
