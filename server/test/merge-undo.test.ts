import { EventDetail, FamilyDetail, History, PersonDetail, PersonSearchResult, ProposalView, UndoPreview } from '@rodokmen/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import type { TestDatabase } from './db.js';
import { errorOf, idOf } from './helpers.js';
import { citation, useProposalTestbed } from './proposal-testbed.js';

const L = generateFixture().landmarks;

describe('Merging Persons and undoing Proposals', () => {
  const { ready, call, submit, person, count } = useProposalTestbed();
  let t: TestDatabase;
  let editor: Account;
  let contributor: Account;
  let other: Account;
  beforeAll(() => ({ t, editor, contributor, other } = ready()));

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
    const search = async () =>
      PersonSearchResult.parse((await call(contributor, 'GET', '/api/persons?q=zvonar')).json())
        .items.map((i) => i.person.id)
        .sort();
    expect(await search()).toEqual([baptised, married].sort());
    const kept = await person(baptised);
    const gone = await person(married);
    const res = await call(editor, 'POST', `/api/persons/${baptised}/merge`, {
      mergeId: married,
      keepBaseVersion: kept.version,
      mergeBaseVersion: gone.version,
      note: 'Same man: same parents named in both entries',
    });
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
    expect(
      (await call(contributor, 'POST', `/api/persons/${L.janNovak}/merge`, { mergeId: L.founder, keepBaseVersion: jan.version, mergeBaseVersion: 1 }))
        .statusCode,
    ).toBe(403);
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
        await submit(
          editor,
          [
            ...citation('V'),
            { op: 'setField', record: 'person', id: v.id, baseVersion: v.version, set: { sex: 'female' } },
            { op: 'setField', record: 'name', id: name.id, baseVersion: name.version, set: { surname: 'Invented-Nová' } },
            { op: 'attachCitation', citationId: 'tmp:citV', nameId: name.id, baseVersion: name.version },
          ],
          { direct: true },
        )
      ).json(),
    );
    // … and a later one edits the surname again.
    const later = await person(v.id);
    const latestName = later.names[0]!;
    expect(
      (
        await submit(
          editor,
          [
            ...citation('W'),
            { op: 'setField', record: 'name', id: name.id, baseVersion: latestName.version, set: { surname: 'Nová', given: 'Venceslava' } },
            { op: 'attachCitation', citationId: 'tmp:citW', nameId: name.id, baseVersion: latestName.version },
          ],
          { direct: true },
        )
      ).statusCode,
    ).toBe(201);

    const preview = UndoPreview.parse((await call(editor, 'GET', `/api/proposals/${fix.id}/undo`)).json());
    expect(preview.laterEdits).toEqual([
      expect.objectContaining({
        table: 'name',
        id: name.id,
        recordLevel: false,
        fields: [
          { field: 'given', before: 'Věnceslava', after: 'Věnceslava', current: 'Venceslava' },
          { field: 'surname', before: 'Invented', after: 'Invented-Nová', current: 'Nová' },
        ],
      }),
    ]);
    const refused = await call(editor, 'POST', `/api/proposals/${fix.id}/undo`, {});
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused).code).toBe('later_edits');
    expect((await person(v.id)).sex).toBe('female');

    const res = await call(editor, 'POST', `/api/proposals/${fix.id}/undo`, {
      choices: [{ table: 'name', id: name.id, fields: { given: 'keep', surname: 'undo' } }],
    });
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
    expect(FamilyDetail.parse((await call(contributor, 'GET', `/api/families/${L.janFirstFamily}`)).json()).children.map((c) => c.person.id)).not.toContain(
      prokop,
    );
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
          {
            op: 'createSource',
            tempId: 'tmp:fa',
            type: 'family_account',
            title: 'Invented account',
            familyAccount: { givenBy: 'Matěj', givenByPersonId: merge!.gone, givenOn: '1880' },
          },
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
      const res = await submit(editor, [
        ...citation('Q'),
        { op: 'setField', record: 'name', id: jan.names[0]!.id, baseVersion: jan.names[0]!.version, set: { [key]: 'x' } },
      ]);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).message).toContain(`no settable field "${key}"`);
    }
  });
});
