import { LeadDetail, LeadSuggestion, SourceDetail, SuggestionList, type OperationInput } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { archiveLookup } from '../src/leads/archives.js';
import { refreshSuggestions, SEARCH_MARGIN_YEARS } from '../src/leads/gaps.js';
import { dailyJobs, suggestLeads, type JobDeps } from '../src/jobs/daily.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import { DEFAULT_APP_DIR } from '../src/routes/pages.js';
import { MemoryImageStorage } from '../src/storage/images.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createAgentWithToken, bearer, createMember, ensureOwner, errorOf, makeApp, signIn, type TestApp } from './helpers.js';
import { newKey } from './proposal-testbed.js';

const L = generateFixture().landmarks;

/**
 * The gap finder (research-leads spec, "Gap finder suggests leads") through the API and the
 * nightly job, on a fresh copy of the fixture Tree. The fixture has no Family root, so nobody is a
 * Relative until the Owner marks one, and the gap finder suggests nothing until then.
 */
describe('the gap finder', () => {
  let t: TestDatabase;
  let a: TestApp;
  let owner: Account;
  let editor: Account;
  let contributor: Account;
  let token: string;
  const cookies = new Map<string, string>();
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    owner = await ensureOwner(t.db);
    editor = await createMember(t.db, 'editor', { displayName: 'Eva Editor' });
    contributor = await createMember(t.db, 'contributor', { displayName: 'Karel Contributor', language: 'cs' });
    for (const m of [owner, editor, contributor]) cookies.set(m.id, await signIn(t.db, a.clock, m));
    ({ token } = await createAgentWithToken(t.db, a.clock, 'Register reader'));
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  const call = (m: Account | 'agent', method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    a.app.inject({ method, url, headers: m === 'agent' ? bearer(token) : { cookie: cookies.get(m.id)! }, ...(payload === undefined ? {} : { payload }) });
  /** An Editor's direct change, accepted at once; returns the ids of the records it created by temporary id. */
  const direct = async (operations: OperationInput[]) => {
    const res = await call(editor, 'POST', '/api/proposals', { formatVersion: 1, idempotencyKey: newKey(), note: null, direct: true, operations });
    expect(res.statusCode, res.body).toBe(201);
  };
  const created = async (title: string) => (await t.db.selectFrom('source').select('id').where('title', '=', title).executeTakeFirstOrThrow()).id;
  const personNamed = async (asFound: string) =>
    (await t.db.selectFrom('name').select('person_id').where('as_found', '=', asFound).executeTakeFirstOrThrow()).person_id;
  const suggestions = async (query: string, m: Account = contributor) => {
    const res = await call(m, 'GET', `/api/lead-suggestions${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return SuggestionList.parse(res.json()).items;
  };
  const markRoot = async (personId: string) => {
    const res = await call(owner, 'PUT', `/api/persons/${personId}/family-root`, { familyRoot: true });
    expect(res.statusCode, res.body).toBe(200);
  };
  const evidence = (tag: string, sourceId: string): OperationInput[] => [
    { op: 'createCitation', tempId: `tmp:c${tag}`, sourceId, page: '3', transcription: `Invented entry ${tag}.`, readOn: '2026-10-01', confidence: 'high' },
  ];

  it('registers know their Parish, kinds and years, set through Proposals', async () => {
    await direct([
      {
        op: 'createSource',
        tempId: 'tmp:n',
        type: 'parish_register',
        title: 'Invented register N Dolní Kamenec 1784–1820',
        repository: 'Invented archive',
        register: { parishId: L.parishDolniKamenec, kinds: ['birth'], from: 1784, to: 1820 },
      },
      {
        op: 'createSource',
        tempId: 'tmp:o',
        type: 'parish_register',
        title: 'Invented register O Dolní Kamenec 1784–1850',
        repository: 'Invented archive',
        register: { parishId: L.parishDolniKamenec, kinds: ['marriage'], from: 1784, to: 1850 },
      },
      ...evidence('reg', 'tmp:n'),
    ]);
    ids.births = await created('Invented register N Dolní Kamenec 1784–1820');
    ids.marriages = await created('Invented register O Dolní Kamenec 1784–1850');
    const source = SourceDetail.parse((await call(contributor, 'GET', `/api/sources/${ids.births}`)).json());
    expect(source.register).toEqual({ parishId: L.parishDolniKamenec, kinds: ['birth'], from: 1784, to: 1820 });
    // Only a parish register covers a Parish.
    const census = await call(editor, 'POST', '/api/proposals', {
      formatVersion: 1,
      idempotencyKey: newKey(),
      note: null,
      operations: [
        {
          op: 'createSource',
          tempId: 'tmp:x',
          type: 'census',
          title: 'Invented census',
          register: { parishId: L.parishDolniKamenec, kinds: ['birth'], from: null, to: null },
        },
        ...evidence('x', 'tmp:x'),
      ],
    });
    expect(census.statusCode).toBe(400);
  });

  it('suggests nothing for someone who is no Relative', async () => {
    await direct([
      { op: 'createPerson', tempId: 'tmp:p', sex: 'male', name: { given: 'Matouš', surname: 'Invented', type: 'birth', asFound: 'Matthaeus Invented' } },
      { op: 'createEvent', tempId: 'tmp:b', type: 'birth', date: '1801~', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:b', personId: 'tmp:p', role: 'child' },
      { op: 'addName', tempId: 'tmp:n', personId: 'tmp:p', given: 'Matthias', surname: 'Invented', type: 'latin', asFound: 'Matthias Invented' },
      ...evidence('m', ids.births!),
      { op: 'attachCitation', citationId: 'tmp:cm', nameId: 'tmp:n' },
    ]);
    ids.matous = await personNamed('Matthaeus Invented');
    expect(await suggestions(`?personId=${ids.matous}`)).toEqual([]);
  });

  it('missing baptism: once he is a Relative, a suggested lead names the Parish’s birth register and the years 1798–1804', async () => {
    await markRoot(ids.matous!);
    const found = await suggestions(`?personId=${ids.matous}`);
    const ours = found.find((s) => s.kind === 'birth' && s.source?.id === ids.births)!;
    expect(ours).toMatchObject({
      status: 'open',
      person: { id: ids.matous, relation: 'relative' },
      place: { id: L.kamennaLhota },
      source: { title: 'Invented register N Dolní Kamenec 1784–1820' },
      archive: 'Invented archive',
      years: { from: 1798, to: 1804 },
      key: `birth:${ids.matous}:${ids.births}`,
    });
    expect(ours.question.en).toBe('Find the baptism or birth of Matouš Invented: check "Invented register N Dolní Kamenec 1784–1820", years 1798–1804');
    expect(ours.question.cs).toContain('Najít křest nebo narození: Matouš Invented');
    // The fixture's own birth register of that Parish (1784–1830) fits too, and the unknown parents are a gap of their own.
    expect(found.filter((s) => s.kind === 'birth').length).toBe(2);
    expect(found.filter((s) => s.kind === 'parents').map((s) => s.years)).toEqual([
      { from: 1798, to: 1804 },
      { from: 1798, to: 1804 },
    ]);
    expect(SEARCH_MARGIN_YEARS).toBe(1);
  });

  it('dismissed suggestion: the gap finder does not suggest the same lead again, after an accepted Proposal or at night', async () => {
    const [ours] = (await suggestions(`?personId=${ids.matous}`)).filter((s) => s.kind === 'birth' && s.source?.id === ids.births);
    const res = await call(contributor, 'POST', `/api/lead-suggestions/${ours!.id}/dismiss`);
    expect(res.statusCode, res.body).toBe(200);
    expect(LeadSuggestion.parse(res.json()).status).toBe('dismissed');
    expect((await suggestions(`?personId=${ids.matous}`)).map((s) => s.id)).not.toContain(ours!.id);
    // An accepted Proposal that touches him, then the nightly run: still not back.
    await direct([
      { op: 'addName', personId: ids.matous!, baseVersion: 1, given: 'Matthäus', surname: 'Invented', type: 'german', asFound: 'Matthäus Invented' },
      ...evidence('m2', ids.births!),
    ]);
    const deps: JobDeps = {
      db: t.db,
      clock: a.clock,
      mailer: new OutboxMailer(),
      images: new MemoryImageStorage(a.clock),
      publicOrigin: 'http://localhost:3000',
    };
    expect((await suggestLeads(deps, a.clock.now())).complete).toBe(true);
    expect((await suggestions(`?personId=${ids.matous}`)).map((s) => s.key)).not.toContain(ours!.key);
    expect(await t.db.selectFrom('lead_suggestion').select('status').where('key', '=', ours!.key).executeTakeFirstOrThrow()).toEqual({ status: 'dismissed' });
    // Deciding again is refused.
    expect((await call(contributor, 'POST', `/api/lead-suggestions/${ours!.id}/accept`)).statusCode).toBe(409);
  });

  it('a Member accepts a suggestion: it becomes a lead in their language, with the Person, Place, register and years, and is not suggested again', async () => {
    const fixtureRegister = (await suggestions(`?personId=${ids.matous}`)).find((s) => s.kind === 'birth')!;
    const res = await call(contributor, 'POST', `/api/lead-suggestions/${fixtureRegister.id}/accept`);
    expect(res.statusCode, res.body).toBe(201);
    const lead = LeadDetail.parse(res.json());
    expect(lead).toMatchObject({
      status: 'open',
      question: fixtureRegister.question.cs,
      source: { id: fixtureRegister.source!.id },
      years: { from: 1798, to: 1804 },
      fromSuggestion: fixtureRegister.key,
      author: { id: contributor.id },
    });
    expect(lead.persons.map((p) => p.id)).toEqual([ids.matous]);
    expect(lead.places.map((p) => p.id)).toEqual([L.kamennaLhota]);
    expect((await suggestions(`?personId=${ids.matous}`)).map((s) => s.key)).not.toContain(fixtureRegister.key);
    expect((await call(contributor, 'GET', `/api/leads?personId=${ids.matous}`)).json()).toMatchObject({ total: 1 });
  });

  it('a marriage without a Citation: the Parish’s marriage register; a Citation makes the suggestion go', async () => {
    await direct([
      { op: 'createPerson', tempId: 'tmp:w', sex: 'female', name: { given: 'Dorota', surname: 'Invented', type: 'birth', asFound: 'Dorothea Invented' } },
      { op: 'createFamily', tempId: 'tmp:f', partner1Id: ids.matous!, partner2Id: 'tmp:w' },
      { op: 'createEvent', tempId: 'tmp:m', type: 'marriage', date: '1825', placeId: L.dolniKamenec },
      { op: 'addRole', eventId: 'tmp:m', personId: ids.matous!, role: 'partner' },
      { op: 'addRole', eventId: 'tmp:m', personId: 'tmp:w', role: 'partner' },
      {
        op: 'createSource',
        tempId: 'tmp:s',
        type: 'family_account',
        title: 'Invented account',
        familyAccount: { givenBy: 'An invented aunt', givenByPersonId: null, givenOn: '2026-05' },
      },
      ...evidence('w', 'tmp:s'),
    ]);
    const marriage = (await suggestions(`?personId=${ids.matous}`)).filter((s) => s.kind === 'marriage');
    const ours = marriage.find((s) => s.source?.id === ids.marriages)!;
    expect(ours).toMatchObject({ years: { from: 1824, to: 1826 }, place: { id: L.dolniKamenec } });
    expect(ours.partners.map((p) => p.id).sort()).toEqual([ids.matous, await personNamed('Dorothea Invented')].sort());
    // Her own birth is no gap the finder speaks of: she is no Relative (the marriage is not confirmed).
    expect(await suggestions(`?personId=${await personNamed('Dorothea Invented')}`)).toEqual(marriage);

    // Citing the marriage closes the gap: after that Proposal is accepted, the suggestion is gone.
    const event = await t.db.selectFrom('event').select(['id', 'version']).where('type', '=', 'marriage').where('date', '=', '1825').executeTakeFirstOrThrow();
    await direct([...evidence('wm', ids.marriages!), { op: 'attachCitation', citationId: 'tmp:cwm', eventId: event.id, baseVersion: event.version }]);
    expect((await suggestions(`?personId=${ids.matous}`)).filter((s) => s.kind === 'marriage')).toEqual([]);
  });

  it('a baptism Citation closes the birth gap', async () => {
    const birth = await t.db
      .selectFrom('event_role as r')
      .innerJoin('event as e', 'e.id', 'r.event_id')
      .select(['e.id', 'e.version'])
      .where('r.person_id', '=', ids.matous!)
      .where('e.type', '=', 'birth')
      .executeTakeFirstOrThrow();
    await direct([...evidence('mb', ids.births!), { op: 'attachCitation', citationId: 'tmp:cmb', eventId: birth.id, baseVersion: birth.version }]);
    expect((await suggestions(`?personId=${ids.matous}`)).filter((s) => s.kind === 'birth')).toEqual([]);
  });

  it('a register the Tree gains is named at night, when no Proposal touched the Persons it fits', async () => {
    await direct([
      {
        op: 'createPerson',
        tempId: 'tmp:p',
        sex: 'male',
        name: { given: 'Bartoloměj', surname: 'Invented', type: 'birth', asFound: 'Bartholomaeus Invented' },
      },
      { op: 'createEvent', tempId: 'tmp:b', type: 'baptism', date: '1700~', placeId: L.vrbice },
      { op: 'addRole', eventId: 'tmp:b', personId: 'tmp:p', role: 'child' },
      {
        op: 'createSource',
        tempId: 'tmp:s',
        type: 'family_account',
        title: 'Invented account 2',
        familyAccount: { givenBy: 'An invented uncle', givenByPersonId: null, givenOn: '2026-05' },
      },
      ...evidence('bart', 'tmp:s'),
    ]);
    ids.bart = await personNamed('Bartholomaeus Invented');
    await markRoot(ids.bart);
    expect((await suggestions(`?personId=${ids.bart}`)).filter((s) => s.kind === 'birth')).toMatchObject([{ source: null, years: { from: 1697, to: 1703 } }]);

    await direct([
      {
        op: 'createSource',
        tempId: 'tmp:n',
        type: 'parish_register',
        title: 'Invented register N Vrbice 1690–1720',
        repository: 'Invented archive',
        register: { parishId: L.parishVrbice, kinds: ['birth', 'death'], from: 1690, to: 1720 },
      },
      ...evidence('vr', 'tmp:n'),
    ]);
    expect((await suggestions(`?personId=${ids.bart}`)).filter((s) => s.kind === 'birth')[0]!.source).toBeNull();
    const deps: JobDeps = {
      db: t.db,
      clock: a.clock,
      mailer: new OutboxMailer(),
      images: new MemoryImageStorage(a.clock),
      publicOrigin: 'http://localhost:3000',
    };
    await suggestLeads(deps, a.clock.now());
    expect((await suggestions(`?personId=${ids.bart}`)).filter((s) => s.kind === 'birth')).toMatchObject([
      { source: { title: 'Invented register N Vrbice 1690–1720' }, years: { from: 1697, to: 1703 } },
    ]);
  });

  it('only Relatives get suggestions; the nightly job runs at 02:30 Prague time', async () => {
    const all = await suggestions('?limit=200');
    const subjects = all.map((s) => s.person!);
    expect(subjects.length).toBeGreaterThan(0);
    for (const s of all.filter((x) => x.kind !== 'marriage')) expect(s.person?.relation, s.key).toBe('relative');
    expect(
      dailyJobs({ db: t.db, clock: a.clock, mailer: new OutboxMailer(), images: new MemoryImageStorage(a.clock), publicOrigin: '' }).map((j) => [j.name, j.at]),
    ).toContainEqual(['lead-suggestions', { hour: 2, minute: 30 }]);
    // Running it twice changes nothing.
    const before = await t.db.selectFrom('lead_suggestion').selectAll().orderBy('key').execute();
    await t.db.transaction().execute((tx) => refreshSuggestions(tx, a.clock.now(), 'everyone'));
    const after = await t.db.selectFrom('lead_suggestion').selectAll().orderBy('key').execute();
    expect(after.map((r) => [r.key, r.status, r.years_from, r.years_to])).toEqual(before.map((r) => [r.key, r.status, r.years_from, r.years_to]));
  });

  it('suggestions are filtered by Place; an Agent reads them but neither accepts nor dismisses', async () => {
    const atVrbice = await suggestions(`?placeId=${L.vrbice}`);
    expect(atVrbice.length).toBeGreaterThan(0);
    expect(atVrbice.every((s) => s.place?.id === L.vrbice)).toBe(true);
    expect((await call('agent', 'GET', '/api/lead-suggestions')).statusCode).toBe(200);
    const res = await call('agent', 'POST', `/api/lead-suggestions/${atVrbice[0]!.id}/dismiss`);
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('forbidden');
  });
});

describe('the archive of a Place, by its Municipality', () => {
  const lookup = archiveLookup(DEFAULT_APP_DIR);
  it('is the archive of its district, or of its older district where it moved in 2021', () => {
    expect(lookup.archiveOf('554979')).toBe('SOA Plzeň'); // Abertamy, district Karlovy Vary
    expect(lookup.archiveOf('544931')).toBe('Zemský archiv Opava'); // Študlov, kept with its older district
  });
  it('has no answer without a known Municipality or without the app’s data', () => {
    expect(lookup.archiveOf(null)).toBeNull();
    expect(lookup.archiveOf('999001')).toBeNull();
    expect(archiveLookup('/nonexistent-app-dir').archiveOf('554979')).toBeNull();
  });
});
