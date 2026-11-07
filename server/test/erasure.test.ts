import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErasurePreview, History, type OperationInput } from '@rodokmen/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { importErasures, reapplyErasures } from '../src/erasure/service.js';
import type { ExportRepoConfig } from '../src/export/repo.js';
import { runExport } from '../src/export/run.js';
import { generateFixture } from '../src/fixture/generate.js';
import { MemoryImageStorage } from '../src/storage/images.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { bearer, createAgentWithToken, createMember, ensureOwner, makeApp, signIn, TestClock, type TestApp } from './helpers.js';
import { citation, newKey } from './proposal-testbed.js';

const L = generateFixture().landmarks;
/** The invented cousin's names: none of them may remain anywhere after the erasure. */
const GIVEN = 'Kateřina';
const SURNAME = 'Zkušební';
const NICKNAME = 'Katka Zkušebňačka';
const TRANSCRIPTION = 'Invented entry: born 2 April 1990, Kateřina Zkušební, daughter of Jan.';

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).trim();

/**
 * Erasure (erasure spec): the Owner erases an invented Living cousin, and she disappears from
 * the Tree, its search, pages, pedigrees and family pins, from the log, the leads and the
 * Export's history, and a restore of an older Backup erases her again.
 */
describe('Erasure', () => {
  let t: TestDatabase;
  let a: TestApp;
  let images: MemoryImageStorage;
  let owner: Account;
  let editor: Account;
  let contributor: Account;
  let token: string;
  const cookies = new Map<string, string>();
  let cousin: string;
  let creation: string;
  let pending: string;
  let birthEvent: string;
  let residence: string;
  let cousinCitation: string;
  let sharedCitation: string;
  let portrait: { id: string; storage_key: string };
  let leadOnly: string;
  let leadBoth: string;
  let bare: string;
  let repo: ExportRepoConfig;
  const tmp = mkdtempSync(join(tmpdir(), 'rodokmen-erasure-test-'));

  const call = (m: Account, method: 'GET' | 'POST', url: string, payload?: object) =>
    a.app.inject({ method, url, headers: { cookie: cookies.get(m.id)! }, ...(payload === undefined ? {} : { payload }) });
  const submit = async (m: Account, operations: OperationInput[], direct: boolean, note = `Invented note about ${GIVEN} ${SURNAME}`) => {
    const res = await call(m, 'POST', '/api/proposals', { formatVersion: 1, idempotencyKey: newKey(), note, operations, direct });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
  };
  const version = async (table: 'family' | 'person', id: string) =>
    (await t.db.selectFrom(table).select('version').where('id', '=', id).executeTakeFirstOrThrow()).version;
  const exportRun = () => runExport({ db: t.db, clock: a.clock, repo }, '2026-11-05');
  /** Every text of the database that may hold personal data, as one string. */
  const everything = async () => {
    const { rows } = await sql<{ text: string }>`
      select coalesce(string_agg(t, ' '), '') as text from (
        select coalesce(before::text, '') || ' ' || coalesce(after::text, '') as t from log_change
        union all select operation::text || coalesce(corrected::text, '') from proposal_operation
        union all select coalesce(note, '') || coalesce(decision_note, '') || coalesce(reader::text, '') from proposal
        union all select given || ' ' || surname || ' ' || as_found from name
        union all select transcription from citation
        union all select question || ' ' || reason from lead
        union all select fields::text from lead_event
        union all select key from vault_import_map
        union all select slug from export_slug
      ) x`.execute(t.db);
    return rows[0]!.text;
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t, { images: (clock) => (images = new MemoryImageStorage(clock)) });
    owner = await ensureOwner(t.db);
    editor = await createMember(t.db, 'editor', { displayName: 'Eva Editor' });
    contributor = await createMember(t.db, 'contributor', { displayName: 'Karel Contributor' });
    for (const m of [owner, editor, contributor]) cookies.set(m.id, await signIn(t.db, a.clock, m));
    ({ token } = await createAgentWithToken(t.db, a.clock, 'Invented Agent'));

    // An invented Living cousin, born 1990, a child of Jan Novák's first Family (an invented test,
    // whatever the dates): a birth only she took part in, with a Citation that names her, and a
    // residence she shares with someone else, with a Citation also attached to her birth.
    creation = await submit(
      owner,
      [
        ...citation('C', { transcription: TRANSCRIPTION }),
        ...citation('R', { transcription: 'Invented census page of House A.' }),
        { op: 'createPerson', tempId: 'tmp:c', sex: 'female', name: { given: GIVEN, surname: SURNAME, type: 'birth', asFound: `${GIVEN} ${SURNAME}` } },
        { op: 'linkChild', familyId: L.janFirstFamily, childId: 'tmp:c', linkType: 'birth', baseVersion: await version('family', L.janFirstFamily) },
        { op: 'createEvent', tempId: 'tmp:b', type: 'birth', date: '1990-04-02', houseId: L.houseA },
        { op: 'addRole', eventId: 'tmp:b', personId: 'tmp:c', role: 'child' },
        { op: 'attachCitation', citationId: 'tmp:citC', eventId: 'tmp:b' },
        { op: 'attachCitation', citationId: 'tmp:citR', eventId: 'tmp:b' },
        { op: 'createEvent', tempId: 'tmp:r', type: 'residence', date: '2000', houseId: L.houseA },
        { op: 'addRole', eventId: 'tmp:r', personId: 'tmp:c', role: 'other' },
        { op: 'addRole', eventId: 'tmp:r', personId: L.proband, role: 'other' },
        { op: 'attachCitation', citationId: 'tmp:citR', eventId: 'tmp:r' },
        { op: 'addLabel', personId: 'tmp:c', label: 'line/invented-cousin' },
      ],
      true,
    );
    cousin = (await t.db.selectFrom('name').select('person_id').where('surname', '=', SURNAME).executeTakeFirstOrThrow()).person_id;
    const roles = await t.db
      .selectFrom('event_role as r')
      .innerJoin('event as e', 'e.id', 'r.event_id')
      .select(['e.id', 'e.type'])
      .where('r.person_id', '=', cousin)
      .execute();
    birthEvent = roles.find((r) => r.type === 'birth')!.id;
    residence = roles.find((r) => r.type === 'residence')!.id;
    const onBirth = await t.db
      .selectFrom('event_citation as ec')
      .innerJoin('citation as c', 'c.id', 'ec.citation_id')
      .select(['c.id', 'c.transcription'])
      .where('ec.event_id', '=', birthEvent)
      .execute();
    cousinCitation = onBirth.find((c) => c.transcription === TRANSCRIPTION)!.id;
    sharedCitation = onBirth.find((c) => c.transcription !== TRANSCRIPTION)!.id;

    // A pending Proposal that names her (a nickname).
    pending = await submit(
      contributor,
      [
        ...citation('P'),
        { op: 'addName', personId: cousin, baseVersion: await version('person', cousin), given: NICKNAME, surname: '', type: 'nickname', asFound: NICKNAME },
      ],
      false,
    );

    // A portrait of her alone (its file in the image store), and a Member who is her.
    portrait = await t.db
      .insertInto('image')
      .values({
        kind: 'portrait',
        storage_key: 'images/invented-cousin.webp',
        display_key: 'display/invented-cousin.webp',
        content_type: 'image/webp',
        byte_size: 10,
        sha256: 'e'.repeat(64),
      })
      .returning(['id', 'storage_key'])
      .executeTakeFirstOrThrow();
    await t.db.insertInto('image_person').values({ image_id: portrait.id, person_id: cousin }).execute();
    await images.put('images/invented-cousin.webp', Buffer.from('x'), 'image/webp');
    await images.put('display/invented-cousin.webp', Buffer.from('x'), 'image/webp');
    await t.db.updateTable('account').set({ person_id: cousin }).where('id', '=', contributor.id).execute();
    // The importer's map once named her note.
    const batch = await t.db.insertInto('import_batch').values({ name: 'Invented batch', author_id: owner.id }).returning('id').executeTakeFirstOrThrow();
    await t.db
      .insertInto('vault_import_map')
      .values({ key: `people/${GIVEN} ${SURNAME}.md`, kind: 'person', batch_id: batch.id, record_id: cousin })
      .execute();

    // A fixture lead linked to a Living person (research-leads task 1.4): one about her alone, one also about Jan.
    const lead = async (body: object) => {
      const res = await call(contributor, 'POST', '/api/leads', body);
      expect(res.statusCode, res.body).toBe(201);
      return res.json<{ id: string }>().id;
    };
    leadOnly = await lead({ question: `Where did ${GIVEN} go to school?`, reason: 'Invented', personIds: [cousin] });
    leadBoth = await lead({ question: 'Invented question about two people', reason: 'Invented', personIds: [cousin, L.janNovak] });

    bare = join(tmp, 'rodokmen-export.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    repo = { url: bare, branch: 'main', sshKey: null, knownHosts: null, author: { name: 'Rodokmen', email: 'export@localhost' } };
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
    rmSync(tmp, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------- who may erase, and whom

  it('lets only the Owner see what erasure removes, or erase', async () => {
    for (const m of [editor, contributor]) {
      expect((await call(m, 'GET', `/api/persons/${cousin}/erasure`)).statusCode).toBe(403);
      expect((await call(m, 'POST', `/api/persons/${cousin}/erase`, { confirmation: `${GIVEN} ${SURNAME}` })).statusCode).toBe(403);
    }
    expect(
      (await a.app.inject({ method: 'POST', url: `/api/persons/${cousin}/erase`, headers: bearer(token), payload: { confirmation: 'x' } })).statusCode,
    ).toBe(403);
  });

  it('refuses to erase a Person who is not Living, and says only Living people can be erased (scenario "Not Living")', async () => {
    const preview = ErasurePreview.parse((await call(owner, 'GET', `/api/persons/${L.janNovak}/erasure`)).json());
    expect(preview.mayErase).toBe(false);
    const res = await call(owner, 'POST', `/api/persons/${L.janNovak}/erase`, { confirmation: preview.confirmWith });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'not_living' });
    expect(res.json<{ message: string }>().message).toMatch(/^Only Living people can be erased/);
    expect(await t.db.selectFrom('person').select('id').where('id', '=', L.janNovak).executeTakeFirst()).toBeDefined();
  });

  it('shows the Owner what goes before they confirm: the Events only she took part in, her Citation, portrait, leads and history', async () => {
    const preview = ErasurePreview.parse((await call(owner, 'GET', `/api/persons/${cousin}/erasure`)).json());
    expect(preview).toMatchObject({
      mayErase: true,
      confirmWith: `${GIVEN} ${SURNAME}`,
      names: 1,
      roles: 2,
      familyLinks: 1,
      labels: 1,
      citations: 1,
      images: 1,
    });
    expect(preview.events.map((e) => e.id)).toEqual([birthEvent]);
    expect(preview.leads).toEqual({ deleted: 1, unlinked: 1 });
    expect(preview.history).toBe(2);
    expect(preview.pending).toBe(1);
  });

  it('refuses a confirmation that does not name her', async () => {
    const res = await call(owner, 'POST', `/api/persons/${cousin}/erase`, { confirmation: 'Someone Else' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'confirmation_mismatch' });
  });

  // ---------------------------------------------------------------- the Export before

  it('exports her, reduced, before the erasure', async () => {
    expect((await exportRun()).detail).toMatch(/^committed/);
    expect(git(bare, 'ls-tree', '-r', '--name-only', 'main')).toContain('people/katerina-zkusebni-1990.md');
    // A second commit, so that history has more than one.
    const jan = await version('person', L.janNovak);
    await submit(
      editor,
      [...citation('J'), { op: 'addName', personId: L.janNovak, baseVersion: jan, given: 'Jean', surname: 'Novak', type: 'other', asFound: 'Jean Novak' }],
      true,
      'A French spelling of Jan',
    );
    expect((await exportRun()).detail).toMatch(/^committed/);
    expect(git(bare, 'rev-list', '--count', 'main')).toBe('2');
  });

  // ---------------------------------------------------------------- the erasure

  it('erases her (scenario "A cousin asks to be removed")', async () => {
    const before = await t.db
      .selectFrom('person')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    const res = await call(owner, 'POST', `/api/persons/${cousin}/erase`, { confirmation: `  ${GIVEN.toLowerCase()}   ${SURNAME} ` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ personId: cousin, events: 1, citations: 1, images: 1, history: 2 });
    const after = await t.db
      .selectFrom('person')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n - 1);
  });

  it('no longer shows her in search, person pages, pedigrees or family pins', async () => {
    expect((await call(contributor, 'GET', `/api/persons/${cousin}`)).statusCode).toBe(404);
    expect((await call(contributor, 'GET', `/api/persons?q=${encodeURIComponent(SURNAME)}`)).json<{ items: unknown[] }>().items).toEqual([]);
    for (const url of [
      `/api/families/${L.janFirstFamily}`,
      `/api/persons/${L.janNovak}/descendants`,
      `/api/persons/${L.janNovak}/hourglass`,
      `/api/map/events?bbox=15.0,49.0,17.0,51.0&from=1980&to=2026`,
    ]) {
      const res = await call(contributor, 'GET', url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).not.toContain(cousin);
      expect(res.body, url).not.toContain(SURNAME);
    }
  });

  it('removes the Events only she took part in and their Citations, and keeps what others share', async () => {
    expect(await t.db.selectFrom('event').select('id').where('id', '=', birthEvent).executeTakeFirst()).toBeUndefined();
    expect(await t.db.selectFrom('event').select('id').where('id', '=', residence).executeTakeFirst()).toBeDefined();
    expect((await t.db.selectFrom('event_role').select('person_id').where('event_id', '=', residence).execute()).map((r) => r.person_id)).toEqual([L.proband]);
    expect(await t.db.selectFrom('citation').select('id').where('id', '=', cousinCitation).executeTakeFirst()).toBeUndefined();
    expect((await t.db.selectFrom('event_citation').select('event_id').where('citation_id', '=', sharedCitation).execute()).map((c) => c.event_id)).toEqual([
      residence,
    ]);
  });

  it('removes her portrait and its files, and unlinks the Member who was her', async () => {
    expect(await t.db.selectFrom('image').select('id').where('id', '=', portrait.id).executeTakeFirst()).toBeUndefined();
    expect(images.objects.has('images/invented-cousin.webp')).toBe(false);
    expect(images.objects.has('display/invented-cousin.webp')).toBe(false);
    expect((await t.db.selectFrom('account').select('person_id').where('id', '=', contributor.id).executeTakeFirstOrThrow()).person_id).toBeNull();
  });

  it('deletes the lead about her alone and unlinks her from the others (research-leads task 1.4)', async () => {
    expect((await call(contributor, 'GET', `/api/leads/${leadOnly}`)).statusCode).toBe(404);
    const both = await call(contributor, 'GET', `/api/leads/${leadBoth}`);
    expect(both.json<{ persons: Array<{ id: string }> }>().persons.map((p) => p.id)).toEqual([L.janNovak]);
    expect(both.body).not.toContain(cousin);
  });

  it('shows "erased record" in the history of her parents’ Family, with none of her data (scenario "History after erasure")', async () => {
    const res = await call(contributor, 'GET', `/api/history/family/${L.janFirstFamily}`);
    const history = History.parse(res.json());
    const entry = history.items.find((h) => h.proposalId === creation)!;
    expect(entry.summaries).toEqual([{ cs: 'Vymazaný záznam (vymazán 29. 10. 2026)', en: 'Erased record (erased on 2026-10-29)' }]);
    expect(entry.note).toBeNull();
    for (const c of entry.changes) {
      expect(c.before).toEqual({ erased: true, at: '2026-10-29T10:00:00.000Z' });
      expect(c.after).toEqual({ erased: true, at: '2026-10-29T10:00:00.000Z' });
    }
    for (const gone of [cousin, GIVEN, SURNAME, '1990-04-02']) expect(res.body).not.toContain(gone);
  });

  it('leaves none of her data in the log, Proposals, leads or id maps, and closes the pending Proposal about her', async () => {
    const text = await everything();
    for (const gone of [cousin, SURNAME, NICKNAME, '1990-04-02', 'invented-cousin']) expect(text).not.toContain(gone);
    const p = await t.db.selectFrom('proposal').select(['status', 'erased_at', 'note']).where('id', '=', pending).executeTakeFirstOrThrow();
    expect(p).toMatchObject({ status: 'rejected', note: null });
    expect(p.erased_at).not.toBeNull();
    const view = await call(owner, 'GET', `/api/proposals/${creation}`);
    expect(view.json()).toMatchObject({ note: null, operations: [] });
    expect((await t.db.selectFrom('erasure').select('person_id').execute()).map((e) => e.person_id)).toEqual([cousin]);
  });

  it('refuses to undo a Proposal whose entry was erased', async () => {
    const res = await call(editor, 'POST', `/api/proposals/${creation}/undo`, { choices: [], note: null });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'erased' });
    expect((await call(editor, 'GET', `/api/proposals/${creation}/undo`)).statusCode).toBe(409);
  });

  // ---------------------------------------------------------------- 4.2: the Export's history

  it('replaces the Export’s history with a single commit at the next Export, and no earlier commit with her stays reachable (scenario "Export history after erasure")', async () => {
    const old = git(bare, 'rev-parse', 'main');
    expect((await exportRun()).detail).toMatch(/^replaced the history with [0-9a-f]{40}/);
    expect(git(bare, 'rev-list', '--count', '--all')).toBe('1');
    expect(git(bare, 'rev-list', '--all')).not.toContain(old);
    expect(git(bare, 'ls-tree', '-r', '--name-only', 'main')).not.toContain('katerina-zkusebni');
    expect(git(bare, 'log', '--all', '--oneline', '-S', SURNAME)).toBe('');
    expect((await t.db.selectFrom('erasure').select('export_replaced_at').executeTakeFirstOrThrow()).export_replaced_at).not.toBeNull();
    // The night after, history grows again as usual.
    expect((await exportRun()).detail).toMatch(/^no change/);
    expect(git(bare, 'rev-list', '--count', '--all')).toBe('1');
  });

  // ---------------------------------------------------------------- 4.3: restores

  it('erases her again from a restored Backup taken before the erasure, and nothing else (scenario "Restore from an old Backup")', async () => {
    // The old Backup: a database that still holds her (the same id), with her history and lead.
    const old = await createTestDatabase();
    try {
      const oldApp = await makeApp(old, { clock: new TestClock() });
      const oldOwner = await ensureOwner(old.db);
      const cookie = await signIn(old.db, oldApp.clock, oldOwner);
      const res = await oldApp.app.inject({
        method: 'POST',
        url: '/api/proposals',
        headers: { cookie },
        payload: {
          formatVersion: 1,
          idempotencyKey: newKey(),
          note: null,
          direct: true,
          operations: [
            ...citation('O'),
            { op: 'createPerson', tempId: 'tmp:c', sex: 'female', name: { given: GIVEN, surname: SURNAME, type: 'birth', asFound: GIVEN } },
            { op: 'createEvent', tempId: 'tmp:b', type: 'birth', date: '1990-04-02', placeId: L.kamennaLhota },
            { op: 'addRole', eventId: 'tmp:b', personId: 'tmp:c', role: 'child' },
            { op: 'attachCitation', citationId: 'tmp:citO', eventId: 'tmp:b' },
          ],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      await oldApp.app.close();
      const held = (await old.db.selectFrom('name').select('person_id').where('surname', '=', SURNAME).executeTakeFirstOrThrow()).person_id;
      const persons = (await old.db.selectFrom('person').select('id').execute()).map((p) => p.id);
      // The newest list of erasures, in the format `erasures list` prints and a Backup keeps
      // (erasures.tsv), names her by the id she has in this Backup; the restore merges it in.
      expect(await importErasures(old.db, `${held}\t2026-10-29T10:00:00.000Z\nnot an id\n`, new Date())).toBe(1);
      expect(await reapplyErasures({ db: old.db, clock: new TestClock(), images: new MemoryImageStorage(new TestClock()) })).toEqual([held]);

      const remaining = (await old.db.selectFrom('person').select('id').execute()).map((p) => p.id);
      expect(remaining).not.toContain(held);
      expect(remaining.sort()).toEqual(persons.filter((p) => p !== held).sort());
      const { rows } = await sql<{ n: number }>`select count(*)::int as n from log_change where before::text || after::text like ${`%${SURNAME}%`}`.execute(
        old.db,
      );
      expect(rows[0]!.n).toBe(0);
      // Once done, starting again finds nothing to do.
      expect(await reapplyErasures({ db: old.db, clock: new TestClock(), images: new MemoryImageStorage(new TestClock()) })).toEqual([]);
    } finally {
      await old.drop();
    }
  });
});
