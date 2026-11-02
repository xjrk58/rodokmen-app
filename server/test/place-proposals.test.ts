import {
  EstateDetail,
  HouseDetail,
  ParishDetail,
  PlaceDetail,
  PlaceSearchResult,
  ProposalView,
  SourceDetail,
  SourceSearchResult,
  type OperationInput,
} from '@rodokmen/shared';
import { describe, expect, it } from 'vitest';
import { idOf } from './helpers.js';
import { citation, useProposalTestbed } from './proposal-testbed.js';

/**
 * Places, Houses, Parishes and Estates through Proposals (add-vault-import task 1.7): the
 * importer submits them first, as their own Proposals (vault-import spec, "One Proposal per
 * Source note"). They are reviewed, logged and undone like any other change.
 */
describe('Place Proposals', () => {
  const { ready, call, submit } = useProposalTestbed();

  const village: OperationInput[] = [
    ...citation('PL', { page: 'places/invented-village.md', confidence: 'low' }),
    { op: 'createPlace', tempId: 'tmp:place', type: 'village', location: { lat: 49.6, lon: 15.2 }, name: { name: 'Invented Ves', language: 'cs' } },
    { op: 'addPlaceName', placeId: 'tmp:place', name: 'Erfundendorf', language: 'de', period: { from: null, to: '1918' } },
    { op: 'createHouse', tempId: 'tmp:house', placeId: 'tmp:place', numbers: [{ number: '7', period: { from: null, to: '1850' } }, { number: '12' }] },
    { op: 'addHouseNumber', houseId: 'tmp:house', number: '12a', period: { from: '1930', to: null } },
    { op: 'createParish', tempId: 'tmp:parish', name: 'Invented Ves', seatPlaceId: 'tmp:place' },
    { op: 'createEstate', tempId: 'tmp:estate', name: 'Invented Estate' },
    { op: 'linkPlaceParish', placeId: 'tmp:place', parishId: 'tmp:parish', period: { from: '1784', to: null } },
    { op: 'linkPlaceEstate', placeId: 'tmp:place', estateId: 'tmp:estate', period: { from: null, to: '1848' } },
    {
      op: 'createSource',
      tempId: 'tmp:register',
      type: 'parish_register',
      title: 'Invented register N 1784–1820',
      register: { parishId: 'tmp:parish', kinds: ['birth'], from: 1784, to: 1820 },
    },
    { op: 'setNotes', record: 'place', id: 'tmp:place', notes: 'The village by the invented brook.' },
  ];

  it('a Place with its names, a House with its numbers, its Parish and Estate is reviewed, accepted, shown and undone like any other', async () => {
    const { contributor, editor } = ready();
    const res = await submit(contributor, village);
    expect(res.statusCode, res.body).toBe(201);
    const view = ProposalView.parse(res.json());
    expect(view.operations.slice(2).map((o) => o.summary.en)).toEqual([
      'adds the Place Invented Ves (village)',
      'adds the name “Erfundendorf” (de) (…–1918) to Invented Ves',
      'adds the House Invented Ves No. 7 (…–1850), 12',
      'adds the house number 12a (1930–…) to Invented Ves No. 7/12',
      'adds the Parish Invented Ves',
      'adds the Estate Invented Estate',
      'puts Invented Ves in the Parish Invented Ves (1784–…)',
      'puts Invented Ves in the Estate Invented Estate (…–1848)',
      'adds the Source “Invented register N 1784–1820”',
      'writes research notes on Invented Ves (Place): “The village by the invented brook.”',
    ]);
    const accepted = await call(editor, 'POST', `/api/proposals/${view.id}/accept`, {});
    expect(accepted.statusCode, accepted.body).toBe(200);

    const [found] = PlaceSearchResult.parse((await call(contributor, 'GET', '/api/places?q=erfundendorf')).json()).items;
    const place = PlaceDetail.parse((await call(contributor, 'GET', `/api/places/${found!.id}`)).json());
    expect(place).toMatchObject({ type: 'village', name: 'Invented Ves', location: { lat: 49.6, lon: 15.2 }, notes: 'The village by the invented brook.' });
    expect(place.names.map((n) => [n.name, n.language, n.primary, n.period])).toEqual([
      ['Invented Ves', 'cs', true, { from: null, to: null }],
      ['Erfundendorf', 'de', false, { from: null, to: '1918' }],
    ]);
    expect(place.houses[0]!.numbers.map((n) => n.number)).toEqual(['7', '12', '12a']);
    const parish = ParishDetail.parse((await call(contributor, 'GET', `/api/parishes/${place.parishes[0]!.parish.id}`)).json());
    expect(parish).toMatchObject({ name: 'Invented Ves', seatPlaceId: place.id, places: [{ period: { from: '1784', to: null } }] });
    expect(EstateDetail.parse((await call(contributor, 'GET', `/api/estates/${place.estates[0]!.estate.id}`)).json()).places).toHaveLength(1);
    expect(HouseDetail.parse((await call(contributor, 'GET', `/api/houses/${place.houses[0]!.id}`)).json()).place.id).toBe(place.id);
    const sources = SourceSearchResult.parse((await call(contributor, 'GET', `/api/sources?q=${encodeURIComponent('Invented register N 1784')}`)).json());
    const register = SourceDetail.parse((await call(contributor, 'GET', `/api/sources/${sources.items[0]!.id}`)).json());
    expect(register.register).toEqual({ parishId: parish.id, kinds: ['birth'], from: 1784, to: 1820 });

    // An Event at the new House, in a later Proposal, keeps the Place from being undone first.
    const later = await submit(
      editor,
      [
        ...citation('EV'),
        { op: 'createEvent', tempId: 'tmp:e', type: 'residence', date: '1840', houseId: place.houses[0]!.id },
        { op: 'attachCitation', citationId: 'tmp:citEV', eventId: 'tmp:e' },
      ],
      { direct: true },
    );
    expect(later.statusCode, later.body).toBe(201);
    const blocked = await call(editor, 'POST', `/api/proposals/${view.id}/undo`, {});
    expect(blocked.statusCode).toBe(409);
    expect((await call(editor, 'POST', `/api/proposals/${idOf(later)}/undo`, {})).statusCode).toBe(200);
    const undone = await call(editor, 'POST', `/api/proposals/${view.id}/undo`, {});
    expect(undone.statusCode, undone.body).toBe(200);
    expect((await call(contributor, 'GET', `/api/places/${place.id}`)).statusCode).toBe(404);
    expect((await call(contributor, 'GET', `/api/parishes/${parish.id}`)).statusCode).toBe(404);
  });

  it('the settable fields of a Place, House, Parish and Estate change through setField', async () => {
    const { editor } = ready();
    const res = await submit(
      editor,
      village.map((o) => (o.op === 'createPlace' ? { ...o, name: { name: 'Second Invented Ves', language: 'cs' } } : o)),
      {
        direct: true,
      },
    );
    expect(res.statusCode, res.body).toBe(201);
    const [found] = PlaceSearchResult.parse((await call(editor, 'GET', `/api/places?q=${encodeURIComponent('second invented')}`)).json()).items;
    const place = PlaceDetail.parse((await call(editor, 'GET', `/api/places/${found!.id}`)).json());
    const parish = place.parishes[0]!.parish;
    const fix = await submit(
      editor,
      [
        ...citation('FX'),
        {
          op: 'setField',
          record: 'place',
          id: place.id,
          baseVersion: place.version,
          set: { type: 'hamlet', municipality: { code: '599999', name: 'Invented' } },
        },
        { op: 'setField', record: 'parish', id: parish.id, baseVersion: parish.version, set: { name: 'Invented Ves (new)' } },
      ],
      { direct: true },
    );
    expect(fix.statusCode, fix.body).toBe(201);
    expect(PlaceDetail.parse((await call(editor, 'GET', `/api/places/${place.id}`)).json())).toMatchObject({
      type: 'hamlet',
      municipality: { code: '599999', name: 'Invented' },
    });
    expect(ParishDetail.parse((await call(editor, 'GET', `/api/parishes/${parish.id}`)).json()).name).toBe('Invented Ves (new)');
  });
});
