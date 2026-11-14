// An invented House for the House chart tests (tree-charts spec, "House chart", "Succession in a
// House chart"): every name and Place is made up. Ids are fixed, so the golden models stay put.
import type { RowChildLink, RowEvent, RowFamily, RowPerson } from '../src/chart-rows.js';
import type { HouseChartRows } from '../src/house-chart-model.js';
import { id } from './chart-fixture.js';

export const H = {
  house: id(1001),
  place: id(1002),
  vaclav: id(1011),
  dorota: id(1012),
  jan: id(1013),
  kristina: id(1014),
  apolena: id(1015),
  terezie: id(1016),
  karel: id(1017),
  anna: id(1018),
  josefDvorak: id(1019),
  matej: id(1020),
  lukas: id(1021),
  vlasta: id(1022),
  petr: id(1023),
  tomasMaly: id(1024),
  rozalie: id(1025),
  lodgerChild: id(1026),
  godmother: id(1027),
  annaChild: id(1028),
} as const;

export const HF = {
  parents: id(1101),
  jan: id(1102),
  anna: id(1103),
  widow: id(1104),
  lodgers: id(1105),
  lukas: id(1106),
} as const;

const SOURCE = id(1201);

function person(pid: string, sex: RowPerson['sex'], given: string, surname: string, extra: Partial<RowPerson> = {}): RowPerson {
  return {
    id: pid,
    sex,
    relation: 'relative',
    familyRoot: false,
    living: false,
    names: [{ id: `${pid}-n`, given, surname, type: 'birth', primary: true, order: 0 }],
    ...extra,
  };
}

let n = 1300;
function at(type: string, date: string | null, roles: Array<[string, string]>, house = true): RowEvent {
  const year = date === null ? null : Number(date.slice(0, 4));
  return {
    id: id(++n),
    type,
    date,
    placeId: id(1002),
    place: 'Kamenná Lhota',
    houseId: house ? H.house : null,
    houseNumber: house && year !== null ? (year <= 1805 ? '12' : '15') : null,
    roles: roles.map(([personId, role]) => ({ personId, role })),
    sourceIds: [SOURCE],
  };
}

const family = (fid: string, a: string | null, b: string | null): RowFamily => ({ id: fid, partner1Id: a, partner2Id: b, weakLink: false });
let l = 1400;
const child = (familyId: string, childId: string, order: number): RowChildLink => ({
  id: id(++l),
  familyId,
  childId,
  linkType: 'birth',
  order,
  weakLink: false,
});

/** House A of Kamenná Lhota: čp. 12 until 1805, čp. 15 afterwards, and the Families who lived there. */
export function houseRowsFixture(): HouseChartRows {
  n = 1300;
  l = 1400;
  return {
    livingOn: '2026-11-14',
    asOf: { logEntryId: id(1900), acceptedAt: '2026-11-13T10:00:00.000Z' },
    house: {
      id: H.house,
      placeId: H.place,
      place: 'Kamenná Lhota',
      numbers: [
        { number: '12', from: null, to: '1805', validFrom: '-infinity', validTo: '1805-12-31' },
        { number: '15', from: '1806', to: null, validFrom: '1806-01-01', validTo: 'infinity' },
      ],
    },
    persons: [
      person(H.vaclav, 'male', 'Václav', 'Novák'),
      person(H.dorota, 'female', 'Dorota', 'Nováková'),
      person(H.jan, 'male', 'Jan', 'Novák'),
      person(H.kristina, 'female', 'Kristina', 'Nováková'),
      person(H.apolena, 'female', 'Apolena', 'Nováková'),
      person(H.terezie, 'female', 'Terezie', 'Nováková'),
      person(H.karel, 'male', 'Karel', 'Novák'),
      person(H.anna, 'female', 'Anna', 'Nováková'),
      person(H.josefDvorak, 'male', 'Josef', 'Dvořák'),
      person(H.matej, 'male', 'Matěj', 'Svoboda'),
      person(H.lukas, 'male', 'Lukáš', 'Svoboda'),
      person(H.vlasta, 'female', 'Vlasta', 'Svobodová', { living: true }),
      person(H.petr, 'male', 'Petr', 'Svoboda', { living: true }),
      person(H.tomasMaly, 'male', 'Tomáš', 'Malý', { relation: 'unrelated' }),
      person(H.rozalie, 'female', 'Rozálie', 'Malá', { relation: 'unrelated' }),
      person(H.lodgerChild, 'female', 'Marie', 'Malá', { relation: 'unrelated' }),
      person(H.godmother, 'female', 'Alžběta', 'Veselá', { relation: 'unrelated' }),
      person(H.annaChild, 'male', 'Vojtěch', 'Dvořák'),
    ],
    families: [
      family(HF.parents, H.vaclav, H.dorota),
      family(HF.jan, H.jan, H.terezie),
      family(HF.anna, H.josefDvorak, H.anna),
      family(HF.widow, H.matej, H.anna),
      family(HF.lodgers, H.tomasMaly, H.rozalie),
      family(HF.lukas, H.lukas, H.vlasta),
    ],
    childLinks: [
      child(HF.parents, H.kristina, 1),
      child(HF.parents, H.jan, 2),
      child(HF.parents, H.apolena, 3),
      child(HF.jan, H.karel, 1),
      child(HF.jan, H.anna, 2),
      child(HF.anna, H.annaChild, 1),
      child(HF.widow, H.lukas, 1),
      child(HF.lodgers, H.lodgerChild, 1),
      child(HF.lukas, H.petr, 1),
    ],
    events: [
      // "Two generations": Jan's parents had their children baptised here from 1795 to 1810 ...
      at('baptism', '1795-04-02', [
        [H.kristina, 'child'],
        [H.vaclav, 'father'],
        [H.dorota, 'mother'],
      ]),
      // ... a neighbour stood godmother at Jan's baptism ("Godmother from next door") ...
      at('baptism', '1801-03-12', [
        [H.jan, 'child'],
        [H.vaclav, 'father'],
        [H.dorota, 'mother'],
        [H.godmother, 'godparent'],
      ]),
      at('baptism', '1810-08-15', [
        [H.apolena, 'child'],
        [H.dorota, 'mother'],
      ]),
      // ... and Jan and Terezie had theirs baptised here from 1825 to 1830 ("Son takes over").
      at(
        'marriage',
        '1824-11-20',
        [
          [H.jan, 'partner'],
          [H.terezie, 'partner'],
        ],
        false,
      ),
      at('baptism', '1825-01-10', [
        [H.karel, 'child'],
        [H.jan, 'father'],
      ]),
      at('baptism', '1830-06-01', [
        [H.anna, 'child'],
        [H.jan, 'father'],
        [H.terezie, 'mother'],
      ]),
      at('burial', '1850-11-05', [
        [H.jan, 'deceased'],
        [H.karel, 'informant'],
      ]),
      // A lodger Family of Unrelated people, at the same time ("Unrelated lodgers", "Overlapping periods").
      at('baptism', '1832-02-02', [
        [H.lodgerChild, 'child'],
        [H.tomasMaly, 'father'],
        [H.rozalie, 'mother'],
      ]),
      // Anna married Josef Dvořák from another village; their son was baptised here ("Son-in-law marries in").
      at('marriage', '1854-02-01', [
        [H.josefDvorak, 'partner'],
        [H.anna, 'partner'],
      ]),
      at('baptism', '1855-03-03', [
        [H.annaChild, 'child'],
        [H.josefDvorak, 'father'],
        [H.anna, 'mother'],
      ]),
      at('death', '1860-01-15', [[H.josefDvorak, 'deceased']]),
      // The widow married again, and the new Family lived here ("Widow remarries").
      at('marriage', '1862-05-05', [
        [H.matej, 'partner'],
        [H.anna, 'partner'],
      ]),
      at('baptism', '1863-07-07', [
        [H.lukas, 'child'],
        [H.matej, 'father'],
        [H.anna, 'mother'],
      ]),
      at('census', '1869', [
        [H.matej, 'other'],
        [H.anna, 'other'],
        [H.lukas, 'other'],
      ]),
      // A Living child born here: on a Sheet, this Event is left out, and the row with it.
      at(
        'marriage',
        '2005-06-01',
        [
          [H.lukas, 'partner'],
          [H.vlasta, 'partner'],
        ],
        false,
      ),
      at('birth', '2010-05-03', [
        [H.petr, 'child'],
        [H.vlasta, 'mother'],
      ]),
    ],
    sources: [{ id: SOURCE, title: 'Matrika N Kamenná Lhota' }],
  };
}

/** A House with 95 Families over 300 years ("An old House"). */
export function oldHouseRows(): HouseChartRows {
  const base = houseRowsFixture();
  const persons: RowPerson[] = [];
  const families: RowFamily[] = [];
  const events: RowEvent[] = [];
  for (let i = 0; i < 95; i++) {
    const a = id(5000 + 2 * i);
    const fam = id(6000 + i);
    persons.push(person(a, 'male', 'Jakub', 'Starý'));
    families.push(family(fam, a, null));
    events.push({ ...at('residence', `${1650 + 3 * i}`, [[a, 'other']]), id: id(7000 + i) });
  }
  return { ...base, persons, families, childLinks: [], events };
}
