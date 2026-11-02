import { type Kysely, sql } from 'kysely';

/**
 * Names carry a language tag (tree-model spec, "Names carry a language tag"; the Owner's decision
 * on #64). A Name keeps its type, now birth, married, nickname or other, and gets the language it
 * is written in as a BCP 47 tag (`cs`, `la`, `de`, `pl` …), or none when it is not known.
 *
 * - name.language: the tag, checked against the BCP 47 shape in its canonical case (the same
 *   pattern as LANGUAGE_TAG_PATTERN in shared/src/schemas/common.ts).
 * - The per-language types go: a `latin` Name becomes type `other` with `la`, a `german` one
 *   `other` with `de`. Every other Name keeps its type without a tag. The row's version is not
 *   bumped: the Name says what it said before, in the new form.
 * - The stored operations of every Proposal follow (createPerson's name, addName, and a setField
 *   of a Name's type), as written by the author and as corrected by an Editor, so pending and
 *   decided Proposals still parse and read the same. The log is append-only and keeps its
 *   snapshots as they were; an undo converts a legacy type as it writes the snapshot back
 *   (legacyName in server/src/proposals/records.ts).
 *
 * The previous release still running would write the old types and fail the new check, so this
 * one is deployed with the server that reads it (no Proposal is accepted between the two).
 */
export const LANGUAGE_TAG_SQL = '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?(-([0-9a-z]{5,8}|[0-9][0-9a-z]{3}))*$';

/** jsonb of one name-like object: the legacy type replaced and the language set. */
const convert = (value: string) => `
  case
    when ${value}->>'type' = 'latin' then jsonb_set(jsonb_set(${value}, '{type}', '"other"'), '{language}', '"la"')
    when ${value}->>'type' = 'german' then jsonb_set(jsonb_set(${value}, '{type}', '"other"'), '{language}', '"de"')
    else ${value}
  end`;

/** The same for a whole stored operation; null stays null (an operation without a correction). */
const convertOperation = (column: string) => `
  case
    when ${column} is null then null
    when ${column}->>'op' = 'createPerson' then jsonb_set(${column}, '{name}', ${convert(`(${column}->'name')`)})
    when ${column}->>'op' = 'addName' then ${convert(column)}
    when ${column}->>'op' = 'setField' and ${column}->>'record' = 'name' and ${column}->'set' ? 'type'
      then jsonb_set(${column}, '{set}', ${convert(`(${column}->'set')`)})
    else ${column}
  end`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
alter table name add column language text check (language ~ '${LANGUAGE_TAG_SQL}');
alter table name drop constraint name_type_check;

-- The rewrite changes no Name: no version is bumped. The deferred one-primary-Name check runs
-- at once, so that the table can be altered again in this transaction.
alter table name disable trigger name_bump_version;
update name set language = 'la', type = 'other' where type = 'latin';
update name set language = 'de', type = 'other' where type = 'german';
set constraints all immediate;
alter table name enable trigger name_bump_version;
alter table name add constraint name_type_check check (type in ('birth', 'married', 'nickname', 'other'));
-- Back to the default for the migrations after this one (every deferrable check is initially deferred).
set constraints all deferred;

update proposal_operation set operation = ${convertOperation('operation')}, corrected = ${convertOperation('corrected')}
where op in ('createPerson', 'addName', 'setField');
`,
    )
    .execute(db);
}

/** Back to one type per language: a tagged `other` Name in Latin or German becomes `latin` or `german` again; other tags are lost. */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
alter table name drop constraint name_type_check;
alter table name disable trigger name_bump_version;
update name set type = 'latin' where type = 'other' and language = 'la';
update name set type = 'german' where type = 'other' and language = 'de';
set constraints all immediate;
alter table name enable trigger name_bump_version;
alter table name add constraint name_type_check check (type in ('birth', 'married', 'latin', 'german', 'nickname', 'other'));
set constraints all deferred;
alter table name drop column language;
`,
    )
    .execute(db);
}
