// An invented family for the Chart tests (tree-charts spec): every name, Place and Source is
// made up. Ids are fixed, so the golden models stay the same from run to run.
import type { ChartRows, RowChildLink, RowEvent, RowFamily, RowName, RowPerson } from '../src/chart-rows.js';

export const id = (n: number) => `0192f0c4-7a1e-7c3b-9d2a-${String(n).padStart(12, '0')}`;

/** The Persons by name, as ids. */
export const P = {
  jan: id(1),
  terezie: id(2),
  ludmila: id(3),
  karel: id(4),
  anna: id(5),
  josef: id(6),
  antonin: id(7),
  vaclav: id(8),
  tomas: id(9),
  marie: id(10),
  bohumil: id(11),
  eva: id(12),
  lukas: id(13),
  petr: id(14),
  godmother: id(15),
  helena: id(16),
  vlasta: id(17),
  martin: id(18),
} as const;

export const F = {
  janKaterina: id(101),
  janLudmila: id(102),
  karelMarie: id(103),
  antoninHelena: id(104),
  bohumilEva: id(105),
  lukasRuzena: id(106),
} as const;

const S = { matrika: id(201), census: id(202) };
const HOUSE = id(301);
const PLACE = id(302);

type Name = [given: string, surname: string, type?: string];

function person(pid: string, sex: RowPerson['sex'], names: Name[], extra: Partial<RowPerson> = {}): RowPerson {
  return {
    id: pid,
    sex,
    relation: 'relative',
    familyRoot: false,
    living: false,
    names: names.map(([given, surname, type = 'birth'], i): RowName => ({ id: `${pid}-n${i}`, given, surname, type, primary: i === 0, order: i })),
    ...extra,
  };
}

let eventNo = 400;
function event(
  type: string,
  date: string | null,
  roles: Array<[string, string]>,
  at: 'house12' | 'house15' | 'place' | null = 'place',
  sources = [S.matrika],
): RowEvent {
  return {
    id: id(++eventNo),
    type,
    date,
    placeId: at === null ? null : PLACE,
    place: at === null ? null : 'Kamenná Lhota',
    houseId: at === 'house12' || at === 'house15' ? HOUSE : null,
    houseNumber: at === 'house12' ? '12' : at === 'house15' ? '15' : null,
    roles: roles.map(([personId, role]) => ({ personId, role })),
    sourceIds: sources,
  };
}

const family = (fid: string, a: string | null, b: string | null, weakLink = false): RowFamily => ({ id: fid, partner1Id: a, partner2Id: b, weakLink });
let linkNo = 500;
const child = (familyId: string, childId: string, order: number, linkType: RowChildLink['linkType'] = 'birth', weakLink = false): RowChildLink => ({
  id: id(++linkNo),
  familyId,
  childId,
  linkType,
  order,
  weakLink,
});

/** The invented Novák family over five generations, with the cases the spec names. */
export function novakRows(): ChartRows {
  eventNo = 400;
  linkNo = 500;
  const persons = [
    person(P.jan, 'male', [['Jan', 'Novák']]),
    person(P.terezie, 'female', [
      ['Terezie', 'Nováková', 'married'],
      ['Terezie', 'Malá'],
    ]),
    person(P.ludmila, 'female', [['Ludmila', 'Nováková', 'married']]),
    person(P.karel, 'male', [['Karel', 'Novák']]),
    person(P.anna, 'female', [['Anna', 'Nováková']]),
    person(P.josef, 'male', [['Josef', 'Novák']]),
    person(P.antonin, 'male', [['Antonín', 'Novák']]),
    person(P.vaclav, 'male', [['Václav', 'Novák']]),
    person(P.tomas, 'male', [['Tomáš', 'Horák']]),
    person(P.marie, 'female', [
      ['Marie', 'Nováková', 'married'],
      ['Marie', 'Dvořáková'],
    ]),
    person(P.bohumil, 'male', [['Bohumil', 'Novák']], { relation: 'possible' }),
    person(P.eva, 'female', [
      ['Eva', 'Nováková', 'married'],
      ['Eva', 'Nováková'],
    ]),
    person(P.lukas, 'male', [['Lukáš', 'Novák']]),
    person(P.petr, 'male', [['Petr', 'Novák']], { living: true }),
    person(P.godmother, 'female', [['Alžběta', 'Veselá']], { relation: 'unrelated' }),
    person(P.helena, 'female', [['Helena', 'Nováková', 'married']]),
    person(P.vlasta, 'female', [['Vlasta', 'Nováková', 'married']], { living: true }),
    person(P.martin, 'male', [['Martin', 'Novák']], { living: true }),
  ];
  const families = [
    family(F.janKaterina, P.jan, P.terezie),
    family(F.janLudmila, P.jan, P.ludmila),
    family(F.karelMarie, P.karel, P.marie),
    family(F.antoninHelena, P.antonin, P.helena),
    family(F.bohumilEva, P.bohumil, P.eva),
    family(F.lukasRuzena, P.lukas, P.vlasta),
  ];
  const childLinks = [
    child(F.janKaterina, P.karel, 1),
    child(F.janKaterina, P.anna, 2),
    child(F.janKaterina, P.josef, 3),
    child(F.janLudmila, P.antonin, 1),
    child(F.janLudmila, P.vaclav, 2, 'adoptive'),
    child(F.janLudmila, P.tomas, 3, 'step'),
    child(F.karelMarie, P.bohumil, 1, 'birth', true),
    child(F.antoninHelena, P.eva, 1),
    child(F.bohumilEva, P.lukas, 1),
    child(F.lukasRuzena, P.petr, 1),
    child(F.lukasRuzena, P.martin, 2),
  ];
  const events = [
    // Jan: baptised at čp. 12, died at the same House, then čp. 15 (scenario "Renumbered House").
    event(
      'baptism',
      '1801-03-12',
      [
        [P.jan, 'child'],
        [P.godmother, 'godparent'],
      ],
      'house12',
    ),
    event('death', '1850-11-02', [[P.jan, 'deceased']], 'house15'),
    event('marriage', '1825-02-07', [
      [P.jan, 'partner'],
      [P.terezie, 'partner'],
    ]),
    event('death', '1835-04-01', [[P.terezie, 'deceased']]),
    event('marriage', '1837-05-15', [
      [P.jan, 'partner'],
      [P.ludmila, 'partner'],
    ]),
    // Children of the first marriage: 1826, 1828 (died young), and one with no date.
    event(
      'baptism',
      '1826-01-10',
      [
        [P.karel, 'child'],
        [P.jan, 'father'],
        [P.terezie, 'mother'],
      ],
      'house15',
    ),
    event('birth', '1828-03-02', [[P.anna, 'child']], 'house15'),
    event('death', '1830-05-10', [[P.anna, 'deceased']], 'house15'),
    // Of the second: a range of years, an adopted and a step child.
    event('birth', '1838/1840', [[P.antonin, 'child']]),
    event('birth', '1836-06-01', [[P.vaclav, 'child']], null, [S.census]),
    event('birth', '1830-01-01', [[P.tomas, 'child']]),
    event('marriage', '1850~', [
      [P.karel, 'partner'],
      [P.marie, 'partner'],
    ]),
    event('baptism', '1852-09-09', [[P.bohumil, 'child']]),
    event('birth', '1865', [[P.eva, 'child']]),
    // Cousins married: their son is a descendant of Jan in two ways.
    event('marriage', '1885-01-20', [
      [P.bohumil, 'partner'],
      [P.eva, 'partner'],
    ]),
    event('birth', '1890-07-04', [[P.lukas, 'child']]),
    // Living: Lukáš's wife and sons (scenario "Living grandchild").
    event('marriage', '1990-06-01', [
      [P.lukas, 'partner'],
      [P.vlasta, 'partner'],
    ]),
    event('birth', '2010-05-03', [[P.petr, 'child']], 'house15', [S.census]),
    event('birth', '2014~', [[P.martin, 'child']]),
  ];
  return {
    livingOn: '2026-11-14',
    asOf: { logEntryId: id(900), acceptedAt: '2026-11-13T10:00:00.000Z' },
    persons,
    families,
    childLinks,
    events,
    sources: [
      { id: S.matrika, title: 'Matrika N Kamenná Lhota 1784–1850' },
      { id: S.census, title: 'Sčítání lidu 1869' },
    ],
  };
}

/** A copy of the rows with every list in another order (scenario "Records in another order"). */
export function shuffled(rows: ChartRows, seed = 7): ChartRows {
  let state = seed;
  const rand = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const mix = <T>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return {
    ...rows,
    persons: mix(rows.persons).map((p) => ({ ...p, names: mix(p.names) })),
    families: mix(rows.families),
    childLinks: mix(rows.childLinks),
    events: mix(rows.events).map((e) => ({ ...e, roles: mix(e.roles), sourceIds: mix(e.sourceIds) })),
    sources: mix(rows.sources),
  };
}
