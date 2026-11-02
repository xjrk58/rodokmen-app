import { describeOperations, LANGUAGE_TAG_PATTERN, Operation, PersonSearchResult, ProposalView, type OperationInput } from '@rodokmen/shared';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, migrateToLatest, MIGRATIONS, type Db } from '../src/db/db.js';
import { LANGUAGE_TAG_SQL } from '../src/db/migrations/0010_name_languages.js';
import { generateFixture } from '../src/fixture/generate.js';
import { applyOperations } from '../src/proposals/apply.js';
import { dropDatabase } from './db.js';
import { databaseUrl } from './global-setup.js';
import { errorOf, idOf } from './helpers.js';
import { citation, useProposalTestbed } from './proposal-testbed.js';

/**
 * Names carry a language tag (tree-model spec, "Names carry a language tag"; add-vault-import
 * tasks 0.2 and 0.3): a Name has its type and, apart, the BCP 47 tag of its language.
 */
const L = generateFixture().landmarks;

describe('Names carry a language tag (tree-model spec)', () => {
  const { ready, call, submit, person } = useProposalTestbed();

  it('Latin form at baptism: the Latin spelling is another Name tagged la, the primary Name is tagged cs, and "joannes" finds him', async () => {
    const jan = await person(L.janNovak);
    const primary = jan.names.find((n) => n.primary)!;
    expect(primary).toMatchObject({ type: 'birth', language: 'cs', asFound: 'Jan Novák' });
    expect(jan.names.find((n) => n.asFound === 'Joannes Nowak')).toMatchObject({ type: 'other', language: 'la', primary: false });
    const hits = PersonSearchResult.parse((await call(ready().contributor, 'GET', '/api/persons?q=joannes')).json()).items;
    expect(hits.find((h) => h.person.id === L.janNovak)?.matchedName).toBe('Joannes Nowak');
  });

  it('Polish form without a new type: a Name of its type with the tag pl, said in words in review', async () => {
    const { contributor, editor } = ready();
    const jan = await person(L.janNovak);
    const res = await submit(contributor, [
      ...citation('PL'),
      {
        op: 'addName',
        tempId: 'tmp:n',
        personId: L.janNovak,
        baseVersion: jan.version,
        given: 'Jan',
        surname: 'Nowak',
        type: 'birth',
        language: 'pl',
        asFound: 'Jan Nowak',
      },
      { op: 'attachCitation', citationId: 'tmp:citPL', nameId: 'tmp:n' },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    const view = ProposalView.parse(res.json());
    expect(view.operations[2]!.summary.en).toBe('adds the Name “Jan Nowak” (birth name, Polish) to Jan Novák');
    expect(view.operations[2]!.summary.cs).toBe('přidává jméno „Jan Nowak“ (rodné jméno, polsky) osobě: Jan Novák');
    expect((await call(editor, 'POST', `/api/proposals/${view.id}/accept`, {})).statusCode).toBe(200);
    expect((await person(L.janNovak)).names.find((n) => n.asFound === 'Jan Nowak')).toMatchObject({ type: 'birth', language: 'pl' });
  });

  it('language not known: a Name without a tag is kept without one', async () => {
    const { contributor, editor } = ready();
    const founder = await person(L.founder);
    const primary = founder.names.find((n) => n.primary)!;
    const res = await submit(contributor, [
      ...citation('UN'),
      { op: 'addName', tempId: 'tmp:n', personId: L.founder, baseVersion: founder.version, given: 'Vašek', surname: '', type: 'nickname', asFound: 'Vašek' },
      { op: 'attachCitation', citationId: 'tmp:citUN', nameId: 'tmp:n' },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    expect(ProposalView.parse(res.json()).operations[2]!.summary.en).toBe(`adds the Name “Vašek” (nickname) to ${primary.given} ${primary.surname}`);
    expect((await call(editor, 'POST', `/api/proposals/${idOf(res)}/accept`, {})).statusCode).toBe(200);
    expect((await person(L.founder)).names.find((n) => n.asFound === 'Vašek')).toMatchObject({ type: 'nickname', language: null });
  });

  it('not a language tag: a Name with the language "Latin" is refused, naming the language field; so are the old types', async () => {
    const jan = await person(L.janNovak);
    const name = (over: Partial<Record<string, unknown>>): OperationInput[] => [
      ...citation('X'),
      { op: 'addName', personId: L.janNovak, baseVersion: jan.version, given: 'Joannes', surname: 'Nowak', type: 'other', asFound: 'Joannes Nowak', ...over },
    ];
    for (const over of [{ language: 'Latin' }, { language: 'LA' }, { language: 'la_CZ' }]) {
      const res = await submit(ready().contributor, name(over));
      expect(res.statusCode, JSON.stringify(over)).toBe(400);
      expect(errorOf(res).message).toMatch(/operation 3 \(addName\) language: a BCP 47 language tag/);
    }
    const old = await submit(ready().contributor, name({ type: 'latin' }));
    expect(old.statusCode).toBe(400);
    expect(errorOf(old).message).toMatch(/operation 3 \(addName\) type/);
    // The database checks the shape too, with the same pattern.
    expect(LANGUAGE_TAG_SQL).toBe(LANGUAGE_TAG_PATTERN.source);
    await expect(sql`update name set language = 'Latin' where person_id = ${L.janNovak}`.execute(ready().t.db)).rejects.toThrow(/name_language_check/);
    for (const tag of ['cs', 'la', 'de', 'pl', 'ru', 'sr-Latn', 'de-AT', 'es-419', 'sl-rozaj', 'de-1901']) expect(tag).toMatch(LANGUAGE_TAG_PATTERN);
  });
});

/** The migration of Names written before the tags (add-vault-import task 0.2), on an empty database. */
describe('Names recorded before the tags (migration 0010_name_languages)', () => {
  const name = `${inject('templateDatabase').replace(/_tpl$/, '')}_names_${randomBytes(3).toString('hex')}`;
  let admin: pg.Client;
  let db: Db;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: inject('adminDatabaseUrl') });
    await admin.connect();
    await admin.query(`create database ${name}`);
    db = createDb(databaseUrl(inject('adminDatabaseUrl'), name), { max: 2 });
    const migrator = new Migrator({
      db,
      provider: { getMigrations: async () => MIGRATIONS },
      migrationTableName: 'schema_migration',
      migrationLockTableName: 'schema_migration_lock',
    });
    const { error } = await migrator.migrateTo('0009_research_leads');
    expect(error).toBeUndefined();
  });
  afterAll(async () => {
    await db?.destroy();
    await dropDatabase(admin, name);
    await admin.end();
  });

  it('turns Latin and German forms into tagged Names of type other, keeps every other Name, and rewrites the stored operations', async () => {
    // The Tree as it was: a Person with a birth name, a Latin and a German form, and a Proposal that wrote them.
    const ids = await sql<{ person: string; latin: string; german: string; birth: string; proposal: string; owner: string }>`
      with owner as (insert into account (email, display_name, language, role) values ('owner@example.test', 'Owner Example', 'cs', 'owner') returning id),
      p as (insert into person (sex) values ('male') returning id),
      birth as (insert into name (person_id, given, surname, type, as_found, is_primary) select id, 'Jan', 'Invented', 'birth', 'Jan Invented', true from p returning id),
      latin as (insert into name (person_id, given, surname, type, as_found, sort_order) select id, 'Joannes', 'Inventus', 'latin', 'Joannes Inventus', 1 from p returning id),
      german as (insert into name (person_id, given, surname, type, as_found, sort_order) select id, 'Johann', 'Invent', 'german', 'Johann Invent', 2 from p returning id),
      proposal as (insert into proposal (author_id, format_version, idempotency_key) select id, 1, 'legacy-names' from owner returning id)
      select (select id from p) as person, (select id from latin) as latin, (select id from german) as german, (select id from birth) as birth,
        (select id from proposal) as proposal, (select id from owner) as owner`.execute(db);
    const { person, latin, german, birth, proposal } = ids.rows[0]!;
    const legacyOps = [
      { op: 'createPerson', tempId: 'tmp:p', sex: 'male', name: { given: 'Joannes', surname: 'Inventus', type: 'latin', asFound: 'Joannes Inventus' } },
      { op: 'addName', personId: 'tmp:p', given: 'Johann', surname: 'Invent', type: 'german', asFound: 'Johann Invent' },
      { op: 'addName', personId: 'tmp:p', given: 'Jan', surname: 'Invented', type: 'nickname', asFound: 'Honza' },
      { op: 'setField', record: 'name', id: birth, baseVersion: 1, set: { type: 'latin', asFound: 'Joannes' } },
      { op: 'setField', record: 'name', id: birth, baseVersion: 1, set: { asFound: 'Jan' } },
    ];
    for (const [position, op] of legacyOps.entries()) {
      await sql`insert into proposal_operation (proposal_id, position, op, operation, corrected, corrected_by)
        values (${proposal}, ${position}, ${op.op}, ${JSON.stringify(op)}::jsonb, ${position === 1 ? JSON.stringify({ ...op, given: 'Johannes' }) : null}::jsonb,
          ${position === 1 ? ids.rows[0]!.owner : null})`.execute(db);
    }

    expect(await migrateToLatest(db)).toContain('0010_name_languages');

    const names = await db
      .selectFrom('name')
      .select(['id', 'type', 'language', 'version', 'as_found'])
      .where('person_id', '=', person)
      .orderBy('sort_order')
      .execute();
    expect(names).toEqual([
      { id: birth, type: 'birth', language: null, version: 1, as_found: 'Jan Invented' },
      { id: latin, type: 'other', language: 'la', version: 1, as_found: 'Joannes Inventus' },
      { id: german, type: 'other', language: 'de', version: 1, as_found: 'Johann Invent' },
    ]);
    const stored = await db
      .selectFrom('proposal_operation')
      .select(['operation', 'corrected'])
      .where('proposal_id', '=', proposal)
      .orderBy('position')
      .execute();
    const ops = stored.map((s) => Operation.parse(s.operation));
    expect(ops[0]).toMatchObject({ name: { type: 'other', language: 'la', asFound: 'Joannes Inventus' } });
    expect(ops[1]).toMatchObject({ type: 'other', language: 'de' });
    expect(Operation.parse(stored[1]!.corrected)).toMatchObject({ type: 'other', language: 'de', given: 'Johannes' });
    expect(ops[2]).toMatchObject({ type: 'nickname', language: null });
    expect(ops[3]).toMatchObject({ set: { type: 'other', language: 'la', asFound: 'Joannes' } });
    expect(ops[4]).toEqual(legacyOps[4]);
    // Their sentences read the same way as before, in the new form.
    const labels = { label: (ref: string) => (ref === 'tmp:p' ? 'Joannes Inventus' : ref) };
    expect(describeOperations(ops, labels).map((s) => s.en)).toEqual([
      'adds the Person Joannes Inventus',
      'adds the Name “Johann Invent” (other form, German) to Joannes Inventus',
      'adds the Name “Honza” (nickname) to Joannes Inventus',
      `changes ${birth} (Name): type → “other”, spelling as found → “Joannes”, language → “la”`,
      `changes ${birth} (Name): spelling as found → “Jan”`,
    ]);
  });

  it('an undo that restores a Name snapshot logged with an old type writes back the new form', async () => {
    const [n] = await db.selectFrom('name').select(['id', 'person_id', 'version']).where('language', '=', 'la').execute();
    const snapshot = (await sql<{ row: Record<string, unknown> }>`select to_jsonb(n.*) as row from name n where id = ${n!.id}`.execute(db)).rows[0]!.row;
    const legacy = { ...snapshot, type: 'latin', language: undefined, as_found: 'Joannes Inventus (restored)' };
    const owner = await db.selectFrom('account').select('id').executeTakeFirstOrThrow();
    await db.transaction().execute(async (tx) => {
      await applyOperations(tx, [{ op: 'restoreRecord', table: 'name', id: n!.id, baseVersion: n!.version, values: legacy }], {
        proposalId: owner.id,
        authorId: owner.id,
      });
    });
    expect(await db.selectFrom('name').select(['type', 'language', 'as_found']).where('id', '=', n!.id).executeTakeFirstOrThrow()).toEqual({
      type: 'other',
      language: 'la',
      as_found: 'Joannes Inventus (restored)',
    });
  });
});
