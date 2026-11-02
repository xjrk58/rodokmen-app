import {
  EstateDetail,
  EventDetail,
  FamilyDetail,
  History,
  HouseDetail,
  ParishDetail,
  PersonSearchResult,
  PlaceDetail,
  ProposalView,
  SourceDetail,
  type OperationInput,
} from '@rodokmen/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { errorOf, idOf } from './helpers.js';
import { useProposalTestbed } from './proposal-testbed.js';

/**
 * Research notes on records and Labels on Persons (tree-model spec, "Research notes on records"
 * and "Labels on Persons"; tree-read-api spec, "Filter by Label"; add-vault-import tasks 1.1, 1.2).
 */
const model = generateFixture();
const L = model.landmarks;

describe('research notes and Labels', () => {
  const { ready, call, submit, person } = useProposalTestbed();
  let editor: Account;
  let contributor: Account;
  beforeAll(() => ({ editor, contributor } = ready()));

  const accept = async (res: { statusCode: number; body: string; json(): unknown }) => {
    expect(res.statusCode, res.body).toBe(201);
    const accepted = await call(editor, 'POST', `/api/proposals/${idOf(res)}/accept`, {});
    expect(accepted.statusCode, accepted.body).toBe(200);
    return ProposalView.parse(accepted.json());
  };
  const direct = (operations: OperationInput[]) => submit(editor, operations, { direct: true });

  it('open question kept: a note on a Person is shown on the person page and appears in its history', async () => {
    const jan = await person(L.janNovak);
    const note = 'baptism not found 1801–1803, check the neighbouring parish';
    const p = await accept(await submit(contributor, [{ op: 'setNotes', record: 'person', id: L.janNovak, baseVersion: jan.version, notes: note }]));
    expect(p.operations[0]!.summary.en).toBe(`writes research notes on Jan Novák (Person): “${note}”`);
    expect((await person(L.janNovak)).notes).toBe(note);
    const history = History.parse((await call(contributor, 'GET', `/api/history/person/${L.janNovak}`)).json()).items;
    expect(history[0]).toMatchObject({ proposalId: p.id, summaries: [{ en: `writes research notes on Jan Novák (Person): “${note}”` }] });
  });

  it('a note needs no evidence: notes and Labels alone go to review without a Citation; a fact still needs one', async () => {
    const jan = await person(L.janNovak);
    const res = await submit(contributor, [
      { op: 'setNotes', record: 'person', id: L.janNovak, baseVersion: jan.version, notes: 'Check the land book.' },
      { op: 'addLabel', personId: L.janNovak, baseVersion: jan.version, label: 'line/novak' },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    expect(ProposalView.parse(res.json()).status).toBe('pending');
    const fact = await submit(contributor, [
      { op: 'setNotes', record: 'person', id: L.janNovak, baseVersion: jan.version, notes: 'x' },
      { op: 'createPerson', tempId: 'tmp:p', sex: 'male', name: { given: 'Nobody', surname: 'Invented', type: 'birth', asFound: 'Nobody' } },
    ]);
    expect(fact.statusCode).toBe(400);
    expect(errorOf(fact).code).toBe('evidence_missing');
  });

  it('every kind of record holds notes, set through one Proposal, and an undo takes them away again', async () => {
    const versions = async () => {
      const get = async (url: string) => z.object({ version: z.number() }).parse((await call(contributor, 'GET', url)).json());
      return {
        family: (await get(`/api/families/${L.janFirstFamily}`)).version,
        event: (await get(`/api/events/${L.janBaptism}`)).version,
        place: (await get(`/api/places/${L.kamennaLhota}`)).version,
        house: (await get(`/api/houses/${L.houseA}`)).version,
        parish: (await get(`/api/parishes/${L.parishVrbice}`)).version,
        estate: (await get(`/api/estates/${L.estateVrbice}`)).version,
        source: (await get(`/api/sources/${L.familyAccountSource}`)).version,
      };
    };
    const v = await versions();
    const ids = {
      family: L.janFirstFamily,
      event: L.janBaptism,
      place: L.kamennaLhota,
      house: L.houseA,
      parish: L.parishVrbice,
      estate: L.estateVrbice,
      source: L.familyAccountSource,
    } as const;
    const records = ['family', 'event', 'place', 'house', 'parish', 'estate', 'source'] as const;
    const ops: OperationInput[] = records.map((record) => ({
      op: 'setNotes',
      record,
      id: ids[record],
      baseVersion: v[record],
      notes: `Notes on the ${record}.`,
    }));
    const p = await accept(await submit(contributor, ops));
    expect(FamilyDetail.parse((await call(contributor, 'GET', `/api/families/${L.janFirstFamily}`)).json()).notes).toBe('Notes on the family.');
    expect(EventDetail.parse((await call(contributor, 'GET', `/api/events/${L.janBaptism}`)).json()).notes).toBe('Notes on the event.');
    expect(PlaceDetail.parse((await call(contributor, 'GET', `/api/places/${L.kamennaLhota}`)).json()).notes).toBe('Notes on the place.');
    expect(HouseDetail.parse((await call(contributor, 'GET', `/api/houses/${L.houseA}`)).json()).notes).toBe('Notes on the house.');
    expect(ParishDetail.parse((await call(contributor, 'GET', `/api/parishes/${L.parishVrbice}`)).json()).notes).toBe('Notes on the parish.');
    expect(EstateDetail.parse((await call(contributor, 'GET', `/api/estates/${L.estateVrbice}`)).json()).notes).toBe('Notes on the estate.');
    expect(SourceDetail.parse((await call(contributor, 'GET', `/api/sources/${L.familyAccountSource}`)).json()).notes).toBe('Notes on the source.');
    // The Place's history shows the change.
    const history = History.parse((await call(contributor, 'GET', `/api/history/place/${L.kamennaLhota}`)).json()).items;
    expect(history.map((h) => h.proposalId)).toContain(p.id);

    const undo = await call(editor, 'POST', `/api/proposals/${p.id}/undo`, {});
    expect(undo.statusCode, undo.body).toBe(200);
    expect(PlaceDetail.parse((await call(contributor, 'GET', `/api/places/${L.kamennaLhota}`)).json()).notes).toBeNull();
    expect(SourceDetail.parse((await call(contributor, 'GET', `/api/sources/${L.familyAccountSource}`)).json()).notes).toBeNull();
  });

  it('a note changed since the Proposal was written is a conflict; the Editor chooses which to keep', async () => {
    const place = PlaceDetail.parse((await call(contributor, 'GET', `/api/places/${L.vrbice}`)).json());
    const mine = await submit(contributor, [{ op: 'setNotes', record: 'place', id: L.vrbice, baseVersion: place.version, notes: 'Mine.' }]);
    expect(mine.statusCode).toBe(201);
    await accept(await submit(contributor, [{ op: 'setNotes', record: 'place', id: L.vrbice, baseVersion: place.version, notes: 'Theirs.' }]));
    const view = ProposalView.parse((await call(editor, 'GET', `/api/proposals/${idOf(mine)}`)).json());
    expect(view.operations[0]!.conflict).toMatchObject({ fields: [{ field: 'notes', proposed: 'Mine.', current: 'Theirs.' }] });
    expect((await call(editor, 'POST', `/api/proposals/${idOf(mine)}/accept`, {})).statusCode).toBe(409);
    const ok = await call(editor, 'POST', `/api/proposals/${idOf(mine)}/accept`, { resolutions: [{ position: 0, fields: { notes: 'current' } }] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(PlaceDetail.parse((await call(contributor, 'GET', `/api/places/${L.vrbice}`)).json()).notes).toBe('Theirs.');
  });

  // ---------------------------------------------------------------- Labels

  const novaks = model.persons
    .filter((p) => model.names.some((n) => n.personId === p.id && n.primary && n.surname.startsWith('Novák')))
    .slice(0, 5)
    .map((p) => p.id);
  /** Someone of another family, who emigrated too. */
  const neighbour = model.names.find((n) => n.primary && !n.surname.startsWith('Novák'))!.personId;
  const search = async (query: string) =>
    PersonSearchResult.parse((await call(contributor, 'GET', `/api/persons?limit=200&${query}`)).json())
      .items.map((h) => h.person.id)
      .sort();

  it('family line: an Editor adds the Label "line/novak" to five Persons, and a search by that Label returns those five', async () => {
    expect(novaks).toHaveLength(5);
    const ops: OperationInput[] = [];
    for (const id of novaks.slice(1)) ops.push({ op: 'addLabel', personId: id, baseVersion: (await person(id)).version, label: 'line/novak' });
    const res = await direct(ops);
    expect(res.statusCode, res.body).toBe(201);
    // Jan carries it from the pending Proposal above only once that is accepted: add it to him directly too.
    expect((await direct([{ op: 'addLabel', personId: novaks[0]!, baseVersion: (await person(novaks[0]!)).version, label: 'Line/Novák' }])).statusCode).toBe(
      201,
    );
    expect(await search('label=line%2Fnovak')).toEqual([...novaks].sort());
    // Ignoring case and diacritics, in the query as in the Label.
    expect(await search(`label=${encodeURIComponent('LINE/NOVÁK')}`)).toEqual([...novaks].sort());
    expect((await person(novaks[1]!)).labels).toEqual(['line/novak']);
    expect((await person(novaks[0]!)).labels).toEqual(['Line/Novák']);
  });

  it('two Labels: only Persons with both are returned', async () => {
    const [a, b] = novaks;
    const res = await direct([
      { op: 'addLabel', personId: a!, baseVersion: (await person(a!)).version, label: 'emigrated' },
      { op: 'addLabel', personId: b!, baseVersion: (await person(b!)).version, label: 'emigrated' },
      { op: 'addLabel', personId: neighbour, baseVersion: (await person(neighbour)).version, label: 'emigrated' },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    expect(await search('label=line%2Fnovak&label=emigrated')).toEqual([a!, b!].sort());
    expect(await search('label=emigrated&q=nov')).toEqual(expect.arrayContaining([a!, b!].sort()));
  });

  it('a Label once per Person, compared ignoring case and diacritics; removing one takes it off', async () => {
    const id = novaks[2]!;
    const twice = await direct([{ op: 'addLabel', personId: id, baseVersion: (await person(id)).version, label: 'LINE/NOVÁK' }]);
    expect(twice.statusCode).toBe(409);
    expect(errorOf(twice).message).toMatch(/already carries the Label/);
    const removed = await direct([{ op: 'removeLabel', personId: id, baseVersion: (await person(id)).version, label: 'Line/Novak' }]);
    expect(removed.statusCode, removed.body).toBe(201);
    expect(ProposalView.parse(removed.json()).operations[0]!.summary.en).toMatch(/^takes the Label “Line\/Novak” off /);
    expect((await person(id)).labels).toEqual([]);
    expect(await search('label=line%2Fnovak')).not.toContain(id);
  });

  it('a merge moves the Labels to the kept Person without doubling them', async () => {
    const [keep, gone] = [novaks[3]!, novaks[4]!];
    const a = await person(keep);
    const b = await person(gone);
    const res = await call(editor, 'POST', `/api/persons/${keep}/merge`, { mergeId: gone, keepBaseVersion: a.version, mergeBaseVersion: b.version });
    expect(res.statusCode, res.body).toBe(200);
    expect((await person(keep)).labels).toEqual(['line/novak']);
  });
});
