import { ProposalView } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../src/fixture/generate.js';
import { labelsFor } from '../src/proposals/labels.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { citation, useProposalTestbed } from './proposal-testbed.js';

const L = generateFixture().landmarks;

describe('labels of existing records in review and history sentences', () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => t?.drop());

  it("names a Role in the reader's language", async () => {
    const godparent = await t.db
      .selectFrom('event_role')
      .select('id')
      .where('event_id', '=', L.janBaptism)
      .where('role', '=', 'godparent')
      .executeTakeFirstOrThrow();
    const labels = await labelsFor(t.db, [godparent.id]);
    expect(labels.label(godparent.id, 'cs')).toMatch(/\(kmotr\)$/);
    expect(labels.label(godparent.id, 'en')).toMatch(/\(godparent\)$/);
  });

  it('labels a House by its Place and every number it carried', async () => {
    const labels = await labelsFor(t.db, [L.houseA]);
    expect(labels.label(L.houseA, 'cs')).toBe('Kamenná Lhota čp. 12/15');
    expect(labels.label(L.houseA, 'en')).toBe('Kamenná Lhota No. 12/15');
  });

  it('labels an image by its kind and Citation, and a Person in a portrait by both', async () => {
    const cited = await t.db
      .selectFrom('citation as c')
      .innerJoin('source as s', 's.id', 'c.source_id')
      .select(['c.id', 'c.page', 's.title'])
      .where('c.page', 'is not', null)
      .executeTakeFirstOrThrow();
    const image = (kind: 'page' | 'portrait', n: number) =>
      t.db
        .insertInto('image')
        .values({
          kind,
          citation_id: kind === 'page' ? cited.id : null,
          storage_key: `images/labels-test-${n}`,
          content_type: 'image/jpeg',
          byte_size: 1000,
          sha256: String(n).repeat(64),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    const page = await image('page', 1);
    const portrait = await image('portrait', 2);
    const shown = await t.db.insertInto('image_person').values({ image_id: portrait.id, person_id: L.janNovak }).returning('id').executeTakeFirstOrThrow();
    const labels = await labelsFor(t.db, [page.id, portrait.id, shown.id, L.janNovak]);
    const jan = labels.label(L.janNovak, 'en');
    expect([page.id, portrait.id, shown.id].map((id) => [labels.label(id, 'cs'), labels.label(id, 'en')])).toEqual([
      [`snímek stránky („${cited.title}“, s. ${cited.page})`, `the page image of “${cited.title}”, p. ${cited.page}`],
      ['portrét', 'the portrait'],
      [`${jan} – portrét`, `${jan} in the portrait`],
    ]);
  });
});

describe('labels of records an undo removed, from the log (#74)', () => {
  const { ready, call, submit } = useProposalTestbed();

  it('labels each record as the log last saw it, in Czech and English; a record never logged keeps the end of its id', async () => {
    const { t, editor, contributor } = ready();
    const p = ProposalView.parse(
      (
        await submit(contributor, [
          { op: 'createPerson', tempId: 'tmp:p', sex: 'female', name: { given: 'Ludmila', surname: 'Invented', type: 'birth', asFound: 'Ludmilla Inventa' } },
          { op: 'addName', tempId: 'tmp:n', personId: 'tmp:p', given: 'Lidmila', surname: 'Invented', type: 'german', asFound: 'Lidmila' },
          { op: 'createPerson', tempId: 'tmp:c', sex: 'male', name: { given: 'Václav', surname: 'Invented', type: 'birth', asFound: 'Wenceslaus' } },
          { op: 'createEvent', tempId: 'tmp:e', type: 'baptism', date: '1830-05-06', placeId: L.kamennaLhota },
          { op: 'addRole', eventId: 'tmp:e', personId: 'tmp:c', role: 'child' },
          { op: 'createFamily', tempId: 'tmp:f', partner1Id: 'tmp:p', partner2Id: null },
          { op: 'linkChild', familyId: 'tmp:f', childId: 'tmp:c', linkType: 'birth' },
          ...citation('L'),
          { op: 'attachCitation', citationId: 'tmp:citL', eventId: 'tmp:e' },
          { op: 'attachCitation', citationId: 'tmp:citL', nameId: 'tmp:n' },
        ])
      ).json(),
    );
    expect((await call(editor, 'POST', `/api/proposals/${p.id}/accept`, {})).statusCode).toBe(200);
    const created = await t.db
      .selectFrom('log_change as c')
      .innerJoin('log_entry as l', 'l.id', 'c.log_entry_id')
      .select(['c.record_table', 'c.record_id'])
      .where('l.proposal_id', '=', p.id)
      .orderBy('c.seq')
      .execute();
    const undo = await call(editor, 'POST', `/api/proposals/${p.id}/undo`, {});
    expect(undo.statusCode, undo.body).toBe(200);
    expect(
      await t.db
        .selectFrom('person')
        .select('id')
        .where(
          'id',
          'in',
          created.map((c) => c.record_id),
        )
        .execute(),
    ).toEqual([]);

    const never = '0192f0c4-7a1e-7c3b-9d2a-0000000a1b2c';
    const labels = await labelsFor(t.db, [...created.map((c) => c.record_id), never]);
    const said: Record<string, string[][]> = {};
    for (const c of created) (said[c.record_table] ??= []).push([labels.label(c.record_id, 'cs'), labels.label(c.record_id, 'en')]);
    expect(said).toEqual({
      person: [
        ['Ludmila Invented', 'Ludmila Invented'],
        ['Václav Invented', 'Václav Invented'],
      ],
      name: [
        ['„Ludmilla Inventa“', '“Ludmilla Inventa”'],
        ['„Lidmila“', '“Lidmila”'],
        ['„Wenceslaus“', '“Wenceslaus”'],
      ],
      event: [['křest 1830-05-06', 'the baptism of 1830-05-06']],
      event_role: [['Václav Invented (dítě)', 'Václav Invented (child)']],
      family: [['rodina Ludmila Invented', 'the Family of Ludmila Invented']],
      family_child: [['Václav Invented', 'Václav Invented']],
      source: [['„Invented register L“', '“Invented register L”']],
      citation: [['„Invented register L“, s. 17', '“Invented register L”, p. 17']],
      event_citation: [['„Invented register L“, s. 17 – křest 1830-05-06', '“Invented register L”, p. 17 for the baptism of 1830-05-06']],
      name_citation: [['„Invented register L“, s. 17 – „Lidmila“', '“Invented register L”, p. 17 for “Lidmila”']],
    });
    expect([labels.label(never, 'cs'), labels.label(never, 'en')]).toEqual(['záznam 0a1b2c', 'record 0a1b2c']);
  });
});
