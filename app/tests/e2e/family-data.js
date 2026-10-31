// A small invented Tree for the family screens' tests (unit tests and the mocked API alike).
// Every Person and Place is made up, with the names of the server's invented fixture. Built in:
// a man married twice with children from both marriages (Jan), a girl who is the birth child of
// one Family and the adoptive child of another (Marie, 1885), a godmother (Rozálie), a man born,
// married and buried in three villages (Antonín), Living people (Jaroslav, Bedřich), a village
// abroad, and a line seven generations deep (Šimon, Vojtěch, Prokop, Václav, Tomáš, Jan, Karel).
// With Family roots (Václav and Anna, see withRelations in family-api.js), Šimon, Vojtěch and Bedřich are
// Possible relatives through weak links, and a godmother (Josefa) and a villager (Jakub Novák)
// are Unrelated people.

/** @typedef {import('../../src/types.js').PersonSummary} PersonSummary */
/** @typedef {import('../../src/types.js').PersonDetail} PersonDetail */
/** @typedef {import('../../src/types.js').Hourglass} Hourglass */
/** @typedef {import('../../src/types.js').MapEventsResult} MapEventsResult */
/** @typedef {import('../../src/types.js').PlaceEvents} PlaceEvents */
/** @typedef {import('../../src/types.js').PersonSearchResult} PersonSearchResult */
/** @typedef {import('../../src/types.js').ChildLinkType} ChildLinkType */
/** @typedef {import('../../src/types.js').EventType} EventType */
/** @typedef {import('../../src/types.js').RoleType} RoleType */
/** @typedef {import('../../src/types.js').Sex} Sex */

export const ID = (/** @type {number} */ n) => `0192f0c4-7a1e-7c3b-9d2a-${String(n).padStart(12, '0')}`;

/** @type {Array<[number, Sex, string, string, string | null, string | null, string[]?]>} id, sex, given, surname, birth, death, other Names */
export const PEOPLE = [
  [1, 'male', 'Václav', 'Novák', '1745~', '1805-02-11', ['Wenceslaus Nowak']],
  [2, 'female', 'Anna', 'Dvořáková', '1750', '../1805', ['Anna Dworzakowa']],
  [3, 'male', 'Tomáš', 'Novák', '1772-12-21', '1831-10-06'],
  [4, 'male', 'Matěj', 'Svoboda', '1744', '1810'],
  [5, 'female', 'Kateřina', 'Svobodová', '1748', '1812'],
  [6, 'female', 'Marie', 'Svobodová', '1776-08-15', '1839-01-12'],
  [7, 'female', 'Rozálie', 'Svobodová', '1779-09-02', '1850'],
  [8, 'male', 'Prokop', 'Novák', '1720', '1780'],
  [9, 'female', 'Apolena', 'Nováková', '1724', '1790'],
  [10, 'male', 'Jan', 'Novák', '1801-03-12', '1850-11-03', ['Joannes Nowak', 'Johann Nowak']],
  [11, 'female', 'Anna', 'Nováková', '1804', '1870'],
  [12, 'female', 'Kateřina', 'Procházková', '1804-04-29', '1835-03-02'],
  [13, 'male', 'Karel', 'Novák', '1827-01-28', '1887-09-30'],
  [14, 'female', 'Marie', 'Nováková', '1829-07-02', '1890'],
  [15, 'female', 'Ludmila', 'Veselá', '1812-09-16', '1871-03-15'],
  [16, 'male', 'Antonín', 'Novák', '1840-05-02', '1912-01-04'],
  [17, 'female', 'Johana', 'Nováková', '1843-01-19', '1900'],
  [18, 'female', 'Barbora', 'Marková', '1858', '1886-02-17'],
  [19, 'female', 'Terezie', 'Černá', '1845', '1915-05-21'],
  [20, 'female', 'Marie', 'Nováková', '1885-12-08', '1950'],
  [21, 'male', 'Bohumil', 'Novák', '1870-08-28', '1938-12-01'],
  [22, 'female', 'Magdalena', 'Horáková', '1874-07-22', '1940'],
  [23, 'female', 'Dorota', 'Nováková', '1902-02-06', '1975-03-30'],
  [24, 'male', 'Jaroslav', 'Novák', '1936-10-02', null],
  [25, 'male', 'Bedřich', 'Novák', null, null],
  [26, 'male', 'Vojtěch', 'Novák', '1700', '1760'],
  [27, 'male', 'Šimon', 'Novák', '1675', '1730'],
  [28, 'female', 'Josefa', 'Kmotrová', '1795', '1861'],
  [29, 'male', 'Jakub', 'Novák', '1790', '1850-04-04'],
];

/** @type {Array<[number, number | null, number | null, Array<[number, ChildLinkType]>]>} id, partner 1, partner 2, children */
const FAMILIES = [
  [100, 27, null, [[26, 'birth']]],
  [101, 26, null, [[8, 'birth']]],
  [102, 8, 9, [[1, 'birth']]],
  [103, 1, 2, [[3, 'birth']]],
  [
    104,
    4,
    5,
    [
      [6, 'birth'],
      [7, 'birth'],
    ],
  ],
  [
    105,
    3,
    6,
    [
      [10, 'birth'],
      [11, 'birth'],
    ],
  ],
  [
    106,
    10,
    12,
    [
      [13, 'birth'],
      [14, 'birth'],
    ],
  ],
  [
    107,
    10,
    15,
    [
      [16, 'birth'],
      [17, 'birth'],
    ],
  ],
  [108, 13, 18, [[20, 'birth']]],
  [
    109,
    16,
    19,
    [
      [21, 'birth'],
      [20, 'adoptive'],
    ],
  ],
  [
    110,
    21,
    22,
    [
      [23, 'birth'],
      [24, 'birth'],
      [25, 'birth'],
    ],
  ],
  // A village couple with no link to the family.
  [111, 29, 28, []],
];

/** @type {Array<[number, string, number | null, { lat: number, lon: number }]>} id, name, house number (a House of the Place) or null, location */
const PLACES = [
  [201, 'Kamenná Lhota', 12, { lat: 49.6, lon: 15.9 }],
  [202, 'Vrbice', null, { lat: 49.64, lon: 15.98 }],
  [203, 'Dolní Kamenec', null, { lat: 49.56, lon: 15.82 }],
  [204, 'Lindenhof', null, { lat: 48.3, lon: 16.2 }],
];
const HOUSE = ID(301);

/** @type {Array<[number, EventType, string, number, boolean, Array<[number, RoleType]>, string]>} id, type, date, Place, at its House, roles, Citation's confidence */
export const EVENTS = [
  [
    401,
    'baptism',
    '1801-03-12',
    201,
    true,
    [
      [10, 'child'],
      [3, 'father'],
      [6, 'mother'],
      [7, 'godparent'],
    ],
    'high',
  ],
  [
    402,
    'marriage',
    '1825-11-22',
    202,
    false,
    [
      [10, 'partner'],
      [12, 'partner'],
    ],
    'normal',
  ],
  [
    403,
    'marriage',
    '1837-02-07',
    201,
    false,
    [
      [10, 'partner'],
      [15, 'partner'],
    ],
    'high',
  ],
  [404, 'death', '1850-11-03', 201, true, [[10, 'deceased']], 'high'],
  [
    405,
    'baptism',
    '1840-05-02',
    201,
    true,
    [
      [16, 'child'],
      [10, 'father'],
      [15, 'mother'],
      [7, 'godparent'],
    ],
    'normal',
  ],
  [
    406,
    'marriage',
    '1866-02-13',
    202,
    false,
    [
      [16, 'partner'],
      [19, 'partner'],
    ],
    'normal',
  ],
  [407, 'burial', '1912-01-07', 203, false, [[16, 'deceased']], 'low'],
  [
    408,
    'baptism',
    '1829-07-02',
    201,
    true,
    [
      [14, 'child'],
      [10, 'father'],
      [12, 'mother'],
      [28, 'godparent'],
    ],
    'normal',
  ],
  [409, 'birth', '1745~', 201, false, [[1, 'child']], 'low'],
  [410, 'residence', '1846', 204, false, [[11, 'other']], 'normal'],
  [412, 'death', '1850-04-04', 202, false, [[29, 'deceased']], 'high'],
  [
    411,
    'baptism',
    '1776-08-15',
    203,
    false,
    [
      [6, 'child'],
      [4, 'father'],
      [5, 'mother'],
    ],
    'normal',
  ],
];

const SOURCE = { id: ID(501), title: 'Invented register 1784–1830' };

/** @param {number} n */
const person = (n) => {
  const p = PEOPLE.find((x) => x[0] === n);
  if (!p) throw new Error(`no Person ${n}`);
  return p;
};

/**
 * @param {number} n
 * @returns {PersonSummary}
 */
export function summary(n) {
  const [, sex, given, surname, birth, death] = person(n);
  const living = death === null && (birth === null || Number(birth.slice(0, 4)) > 1926);
  // Before the Owner marks a Family root, the server says "unrelated" for everyone (see withRelations).
  return { id: ID(n), version: 1, sex, given, surname, displayName: `${given} ${surname}`, living, birth, death, relation: 'unrelated', familyRoot: false };
}

/** Weak child links (family, child): no Citation of normal or higher confidence. */
const WEAK_CHILD_LINKS = [
  [100, 26],
  [101, 8],
  [110, 25],
];

/** @param {string} id */
export const numberOf = (id) => Number(id.slice(-12));

/** @param {number} n */
export const placeRef = (n) => {
  const p = PLACES.find((x) => x[0] === n);
  if (!p) throw new Error(`no Place ${n}`);
  return { id: ID(p[0]), version: 1, name: p[1], location: p[3] };
};

/** @param {(typeof EVENTS)[number]} e */
export function eventSummary(e) {
  const [id, type, date, placeN, atHouse] = e;
  const place = placeRef(placeN);
  const year = date.slice(0, 4);
  return {
    id: ID(id),
    version: 1,
    type,
    typeDetail: null,
    date,
    earliest: date.length === 10 ? date : `${year}-01-01`,
    latest: date.length === 10 ? date : `${year}-12-31`,
    place,
    house: atHouse
      ? { id: HOUSE, version: 1, placeId: place.id, number: '12', location: { lat: place.location.lat + 0.004, lon: place.location.lon + 0.006 } }
      : null,
    description: null,
  };
}

/** @param {number} n */
const citations = (n) => {
  const e = EVENTS.find((x) => x[0] === n);
  return e
    ? [
        {
          id: ID(600 + n),
          version: 1,
          sourceId: SOURCE.id,
          sourceTitle: SOURCE.title,
          page: '41',
          confidence: /** @type {import('../../src/types.js').Confidence} */ (e[6]),
        },
      ]
    : [];
};

/**
 * The person page of an invented Person.
 * @param {number} n
 * @returns {PersonDetail}
 */
export function detail(n) {
  const [, sex, given, surname, , , others = []] = person(n);
  const s = summary(n);
  return {
    id: ID(n),
    version: 1,
    sex,
    living: s.living,
    relation: s.relation,
    familyRoot: s.familyRoot,
    names: [
      { id: ID(1000 + n), version: 1, personId: ID(n), given, surname, type: 'birth', asFound: `${given} ${surname}`, primary: true, citations: [] },
      ...others.map((asFound, i) => ({
        id: ID(1100 + n * 10 + i),
        version: 1,
        personId: ID(n),
        given: asFound.split(' ')[0],
        surname: asFound.split(' ').slice(1).join(' '),
        type: /** @type {import('../../src/types.js').NameType} */ (i === 0 ? 'latin' : 'german'),
        asFound,
        primary: false,
        citations: citations(401),
      })),
    ],
    events: EVENTS.filter((e) => e[5].some(([p]) => p === n)).map((e) => {
      const role = /** @type {RoleType} */ (e[5].find(([p]) => p === n)?.[1]);
      return { roleId: ID(2000 + e[0] * 10 + n), role, roleDetail: null, event: eventSummary(e), citations: citations(e[0]) };
    }),
    familiesAsPartner: FAMILIES.filter((f) => f[1] === n || f[2] === n).map(([id, a, b, children]) => {
      const other = a === n ? b : a;
      return {
        id: ID(id),
        version: 1,
        partner: other === null ? null : summary(other),
        children: children.map(([c, linkType]) => ({ linkId: ID(3000 + id * 10 + c), linkType, person: summary(c) })),
      };
    }),
    familiesAsChild: FAMILIES.filter((f) => f[3].some(([c]) => c === n)).map(([id, a, b, children]) => ({
      id: ID(id),
      version: 1,
      linkId: ID(3000 + id * 10 + n),
      linkType: /** @type {ChildLinkType} */ (children.find(([c]) => c === n)?.[1]),
      partners: [a, b].filter((x) => x !== null).map(summary),
    })),
    portraits: [],
  };
}

/** @param {number} n */
const parentsOf = (n) =>
  FAMILIES.filter((f) => f[3].some(([c]) => c === n))
    .flatMap((f) => [f[1], f[2]])
    .filter((x) => x !== null);
/** @param {number} n */
const familiesOf = (n) => FAMILIES.filter((f) => f[1] === n || f[2] === n);

/**
 * The hourglass around a Person, as GET /api/persons/:id/hourglass answers it.
 * @param {string} focusId
 * @param {number} up
 * @param {number} down
 * @returns {Hourglass}
 */
export function hourglass(focusId, up, down) {
  const focus = numberOf(focusId);
  /** @type {Map<number, Hourglass['persons'][number]>} */
  const persons = new Map();
  /** @param {number} n @param {number} generation @param {Hourglass['persons'][number]['relation']} relation */
  const add = (n, generation, relation) => {
    if (!persons.has(n)) persons.set(n, { generation, relation, moreAbove: false, moreBelow: false, person: summary(n) });
  };
  add(focus, 0, 'focus');
  let row = [focus];
  for (let g = 1; g <= up; g++) {
    row = row.flatMap(parentsOf).filter((p) => !persons.has(p));
    for (const p of row) add(p, g, 'ancestor');
  }
  for (const p of row) {
    const entry = persons.get(p);
    if (entry) entry.moreAbove = parentsOf(p).length > 0;
  }
  // Each row's partners, then their children one row down; the bottom row's partners too, but not their children.
  let below = [focus];
  for (let g = 0; g >= -down; g--) {
    const families = below.flatMap((p) => familiesOf(p).map((f) => ({ p, f })));
    for (const { p, f } of families) {
      const other = f[1] === p ? f[2] : f[1];
      if (other !== null) add(other, g, 'partner');
    }
    const children = g > -down ? families.flatMap(({ f }) => f[3].map(([c]) => c)).filter((c) => !persons.has(c)) : [];
    for (const c of children) add(c, g - 1, 'descendant');
    for (const p of g === -down ? below : []) {
      const entry = persons.get(p);
      if (entry && p !== focus) entry.moreBelow = familiesOf(p).some((f) => f[3].length > 0);
    }
    below = children;
  }
  const included = new Set(persons.keys());
  const families = FAMILIES.filter(
    ([, a, b, children]) =>
      [a, b].some((x) => x !== null && included.has(x)) &&
      (children.some(([c]) => included.has(c)) || (a !== null && b !== null && included.has(a) && included.has(b))),
  );
  return {
    focusId,
    up,
    down,
    persons: [...persons.values()],
    families: families.map(([id, a, b]) => ({
      id: ID(id),
      version: 1,
      partner1Id: a === null ? null : ID(a),
      partner2Id: b === null ? null : ID(b),
      weakLink: false,
    })),
    childLinks: families.flatMap(([id, , , children]) =>
      children
        .filter(([c]) => included.has(c))
        .map(([c, linkType]) => ({
          id: ID(3000 + id * 10 + c),
          familyId: ID(id),
          childId: ID(c),
          linkType,
          weakLink: WEAK_CHILD_LINKS.some(([f, k]) => f === id && k === c),
        })),
    ),
  };
}

export const PLACE = { kamennaLhota: ID(201), vrbice: ID(202), dolniKamenec: ID(203), abroad: ID(204) };
export const P = {
  vaclav: ID(1),
  tomas: ID(3),
  marieSvobodova: ID(6),
  rozalie: ID(7),
  prokop: ID(8),
  jan: ID(10),
  katerina: ID(12),
  karel: ID(13),
  ludmila: ID(15),
  antonin: ID(16),
  marieAdopted: ID(20),
  bohumil: ID(21),
  dorota: ID(23),
  jaroslav: ID(24),
  bedrich: ID(25),
  vojtech: ID(26),
  simon: ID(27),
  josefa: ID(28),
  jakub: ID(29),
};
