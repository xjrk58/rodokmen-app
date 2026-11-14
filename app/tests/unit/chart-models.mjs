// Chart models for the app's unit tests: the golden models of the shared tests (an invented family
// and House), and generated families of every size up to the 500-card limit, made by the very
// rules the server uses (shared/src/charts-model.ts).
import './shared-loader.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP, readJson } from './helpers.mjs';

// After shared-loader.mjs: TypeScript.
const { descendantChart } = await import('../../../shared/src/charts-model.js');
const fixture = await import('../../../shared/test/chart-fixture.js');

/** The invented Novák family of the shared tests (shared/test/chart-fixture.ts), by name. */
export const NOVAK = /** @type {Record<string, string>} */ (fixture.P);

/**
 * A Descendant chart of the invented Novák family, from Jan Novák.
 * @param {{ generations?: number, form?: 'tree' | 'line', line?: string | null, sheet?: 'reduced' | 'nameless' | null }} o
 * @returns {DescendantChart}
 */
export function novakChart(o) {
  return descendantChart(fixture.novakRows(), {
    start: { personId: fixture.P.jan },
    generations: o.generations ?? 4,
    form: o.form ?? 'tree',
    line: o.line ?? null,
    sheet: o.sheet ?? null,
  });
}

/** @typedef {import('../../src/types.js').DescendantChart} DescendantChart */
/** @typedef {import('../../src/types.js').HouseChart} HouseChart */

/**
 * A golden model of shared/test/golden/charts/.
 * @param {string} name
 * @returns {Promise<unknown>}
 */
export async function goldenModel(name) {
  /** @type {unknown} */
  const model = JSON.parse(await readFile(join(APP, '..', 'shared', 'test', 'golden', 'charts', `${name}.json`), 'utf8'));
  return model;
}

/** A golden Descendant chart. @param {string} name */
export const goldenTree = async (name) => /** @type {DescendantChart} */ (await goldenModel(name));
/** A golden House chart. @param {string} name */
export const goldenHouse = async (name) => /** @type {HouseChart} */ (await goldenModel(name));

/** The texts of a language. @param {'cs' | 'en'} lang */
export async function texts(lang) {
  /** @type {unknown} */
  const table = await readJson(`i18n/${lang}.json`);
  return /** @type {Record<string, string>} */ (table);
}

/** The fonts' advance widths. */
export async function fontMetrics() {
  /** @type {unknown} */
  const table = await readJson('data/chart-fonts.json');
  return /** @type {import('../../src/chart-cards.js').FontMetrics} */ (table);
}

const uuid = (/** @type {number} */ n) => `0192f0c4-7a1e-7c3b-9d2a-${String(n).padStart(12, '0')}`;

/**
 * A generated family: from one founder, each couple has 0 to `most` children, birth years in
 * order, a partner for most, now and then a step child; deterministic for its seed.
 * @param {number} seed
 * @param {{ generations: number, most: number }} shape
 * @returns {DescendantChart}
 */
export function generatedChart(seed, shape) {
  let state = seed;
  const rand = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  let n = 0;
  /** @type {any[]} */
  const persons = [];
  /** @type {any[]} */
  const families = [];
  /** @type {any[]} */
  const childLinks = [];
  /** @type {any[]} */
  const events = [];
  const person = (/** @type {number} */ born, /** @type {'male' | 'female'} */ sex) => {
    const id = uuid(++n);
    persons.push({
      id,
      sex,
      relation: 'relative',
      familyRoot: false,
      living: born > 1926,
      names: [{ id: `${id}-n`, given: `Osoba${n}`, surname: 'Zkušební', type: 'birth', primary: true, order: 0 }],
    });
    if (rand() < 0.9)
      events.push({
        id: uuid(100000 + n),
        type: 'birth',
        date: String(born),
        placeId: null,
        place: null,
        houseId: null,
        houseNumber: null,
        roles: [{ personId: id, role: 'child' }],
        sourceIds: [],
      });
    return id;
  };
  const founder = person(1750, 'male');
  let generation = [{ id: founder, born: 1750 }];
  for (let g = 1; g < shape.generations; g++) {
    /** @type {Array<{ id: string, born: number }>} */
    const next = [];
    for (const p of generation) {
      const partner = rand() < 0.85 ? person(p.born + 2, 'female') : null;
      const fam = uuid(200000 + ++n);
      families.push({ id: fam, partner1Id: p.id, partner2Id: partner, weakLink: false });
      const kids = Math.floor(rand() * (shape.most + 1));
      for (let k = 0; k < kids; k++) {
        const born = p.born + 25 + 2 * k;
        const c = person(born, rand() < 0.5 ? 'male' : 'female');
        const step = rand() < 0.05;
        childLinks.push({ id: uuid(300000 + ++n), familyId: fam, childId: c, linkType: step ? 'step' : 'birth', order: k + 1, weakLink: rand() < 0.05 });
        if (!step) next.push({ id: c, born });
      }
    }
    generation = next;
  }
  return descendantChart(
    { livingOn: '2026-11-14', asOf: { logEntryId: null, acceptedAt: null }, persons, families, childLinks, events, sources: [] },
    { start: { personId: founder }, generations: shape.generations, form: 'tree', line: null, sheet: null },
  );
}
