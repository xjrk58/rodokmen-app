import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { descendantChart, houseChart } from '@rodokmen/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { gatherDescendants, gatherHouse } from '../src/charts/gather.js';
import { createDb, migrateToLatest, type Db } from '../src/db/db.js';
import type { FixtureModel } from '../src/fixture/generate.js';
import { loadFixture } from '../src/fixture/load.js';
import { fillKinship } from '../src/tree/kinship.js';
import { databaseUrl } from './global-setup.js';
import { TestClock } from './helpers.js';

/**
 * How long a Chart takes on a Tree the size and shape of the production Tree (add-tree-charts):
 * about 4,100 Persons, 255 Families and 8,900 Events, most Persons in no Family (godparents,
 * residents, people from the registers), all invented. Run on demand with CHART_BENCH=1; with
 * CHART_BENCH_OUT set to a folder, it also writes the models there for timing the app's side.
 */
const RUN = process.env.CHART_BENCH === '1';

let n = 0;
const uuid = () => `0192f0c4-7a1e-7c3b-9d2a-${(++n).toString(16).padStart(12, '0')}`;

/** An invented Tree of the production's size and shape, deterministic. */
function scaleTree(): { model: FixtureModel; founders: string[]; houses: string[] } {
  let state = 4100;
  const rand = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const m: FixtureModel = {
    persons: [],
    names: [],
    families: [],
    childLinks: [],
    places: [],
    placeNames: [],
    houses: [],
    houseNumbers: [],
    parishes: [],
    placeParishes: [],
    estates: [],
    placeEstates: [],
    events: [],
    roles: [],
    sources: [],
    citations: [],
    eventCitations: [],
    nameCitations: [],
    images: [],
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- this invented Tree has no landmarks, and loadFixture does not read them
    landmarks: {} as FixtureModel['landmarks'],
  };
  const houses: string[] = [];
  for (let p = 0; p < 5; p++) {
    const place = uuid();
    m.places.push({
      id: place,
      version: 1,
      type: 'village',
      location: { lat: 49.9 + p / 50, lon: 15.9 + p / 50 },
      municipality: { code: `99910${p}`, name: `Zkušebná ${p}` },
    });
    m.placeNames.push({ id: uuid(), version: 1, placeId: place, name: `Zkušebná ${p}`, language: 'cs', primary: true, period: { from: null, to: null } });
    for (let h = 0; h < 12; h++) {
      const house = uuid();
      houses.push(house);
      m.houses.push({ id: house, version: 1, placeId: place, location: null, note: null });
      m.houseNumbers.push({ id: uuid(), version: 1, houseId: house, number: String(h + 1), period: { from: null, to: '1850' } });
      m.houseNumbers.push({ id: uuid(), version: 1, houseId: house, number: String(h + 40), period: { from: '1851', to: null } });
    }
  }
  const sources = Array.from({ length: 20 }, (_, i) => {
    const id = uuid();
    m.sources.push({
      id,
      version: 1,
      type: 'parish_register',
      title: `Matrika zkušební ${i + 1}`,
      repository: null,
      reference: null,
      url: null,
      familyAccount: null,
      register: null,
    });
    return id;
  });
  const person = (sex: 'male' | 'female', born: number) => {
    const id = uuid();
    m.persons.push({ id, version: 1, sex });
    m.names.push({
      id: uuid(),
      version: 1,
      personId: id,
      given: sex === 'male' ? 'Zkušebník' : 'Zkušebnice',
      surname: `Rod${m.persons.length % 97}`,
      type: 'birth',
      language: 'cs',
      asFound: 'Zkušební',
      primary: true,
    });
    return { id, born, sex };
  };
  const event = (type: FixtureModel['events'][number]['type'], year: number, house: string, roles: Array<[string, FixtureModel['roles'][number]['role']]>) => {
    const id = uuid();
    m.events.push({ id, version: 1, type, typeDetail: null, date: String(year), placeId: null, houseId: house, description: null });
    for (const [personId, role] of roles) m.roles.push({ id: uuid(), version: 1, eventId: id, personId, role, roleDetail: null });
    if (rand() < 0.5) {
      const cid = uuid();
      m.citations.push({
        id: cid,
        version: 1,
        sourceId: sources[Math.floor(rand() * sources.length)]!,
        page: '1',
        transcription: 'Zkušební zápis.',
        readOn: '2026-01-01',
        confidence: 'normal',
        note: null,
      });
      m.eventCitations.push({ id: uuid(), eventId: id, citationId: cid });
    }
    return id;
  };
  // People outside the Families: godparents, neighbours and residents from the registers.
  const pool = Array.from({ length: 2600 }, (_, i) => person(i % 2 ? 'female' : 'male', 1700 + Math.floor(rand() * 220)));
  const pick = () => pool[Math.floor(rand() * pool.length)]!;
  // 15 lines, Family by Family, breadth first, until 255 Families.
  type Couple = { a: { id: string; born: number }; b: { id: string; born: number }; house: string };
  const founders: string[] = [];
  let queue: Couple[] = Array.from({ length: 15 }, () => {
    const a = person('male', 1690 + Math.floor(rand() * 20));
    founders.push(a.id);
    return { a, b: person('female', a.born + 2), house: houses[Math.floor(rand() * houses.length)]! };
  });
  while (queue.length > 0 && m.families.length < 255) {
    const next: Couple[] = [];
    for (const c of queue) {
      if (m.families.length >= 255) break;
      const fam = uuid();
      m.families.push({ id: fam, version: 1, partner1Id: c.a.id, partner2Id: c.b.id });
      event('marriage', c.a.born + 24, c.house, [
        [c.a.id, 'partner'],
        [c.b.id, 'partner'],
        [pick().id, 'witness'],
      ]);
      const kids = 3 + Math.floor(rand() * 4);
      for (let k = 0; k < kids; k++) {
        const kid = person(rand() < 0.5 ? 'male' : 'female', c.a.born + 26 + 2 * k);
        m.childLinks.push({ id: uuid(), version: 1, familyId: fam, childId: kid.id, linkType: 'birth' });
        event('baptism', kid.born, c.house, [
          [kid.id, 'child'],
          [c.a.id, 'father'],
          [c.b.id, 'mother'],
          [pick().id, 'godparent'],
          [pick().id, 'godparent'],
        ]);
        if (kid.born < 1926) event('death', kid.born + 1 + Math.floor(rand() * 70), c.house, [[kid.id, 'deceased']]);
        if (rand() < 0.45) {
          const partner = person(kid.sex === 'male' ? 'female' : 'male', kid.born + 1);
          next.push(kid.sex === 'male' ? { a: kid, b: partner, house: c.house } : { a: partner, b: kid, house: houses[Math.floor(rand() * houses.length)]! });
        }
      }
    }
    queue = next;
  }
  for (const p of m.persons.slice(0, 4100))
    if (!m.roles.some((r) => r.personId === p.id && r.role === 'child'))
      event('birth', 1700 + Math.floor(rand() * 220), houses[Math.floor(rand() * houses.length)]!, [[p.id, 'child']]);
  // Residences and census entries at the Houses, up to 8,900 Events.
  while (m.events.length < 8900) {
    const p = pick();
    event(rand() < 0.5 ? 'census' : 'residence', p.born + 20 + Math.floor(rand() * 40), houses[Math.floor(rand() * houses.length)]!, [[p.id, 'other']]);
  }
  while (m.persons.length < 4100) person('male', 1800);
  return { model: m, founders, houses };
}

/** Milliseconds a step takes. */
async function timed<T>(step: () => Promise<T> | T): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await step();
  return { value, ms: Math.round(performance.now() - start) };
}

describe.skipIf(!RUN)('Charts at the size of the production Tree', () => {
  let admin: pg.Client;
  let db: Db;
  let name: string;
  let tree: ReturnType<typeof scaleTree>;
  const clock = new TestClock(new Date('2026-11-14T09:00:00Z'));

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: inject('adminDatabaseUrl') });
    await admin.connect();
    name = `rdk_chart_scale_${process.pid}`;
    await admin.query(`create database ${name}`);
    db = createDb(databaseUrl(inject('adminDatabaseUrl'), name), { max: 4 });
    await migrateToLatest(db);
    tree = scaleTree();
    await loadFixture(db, tree.model);
  }, 300_000);
  afterAll(async () => {
    await db?.destroy();
    await admin?.query(`drop database if exists ${name} with (force)`);
    await admin?.end();
  });

  it('times a Descendant chart, its line form and a House chart', { timeout: 300_000 }, async () => {
    const { model } = tree;
    console.log(`Tree: ${model.persons.length} Persons, ${model.families.length} Families, ${model.events.length} Events, ${model.roles.length} Roles`);
    const deps = { db, clock };
    // The line with the most descendants.
    const sizes = await Promise.all(tree.founders.map(async (f) => ({ f, rows: await gatherDescendants(deps, { personId: f }, 9) })));
    const biggest = sizes.sort((a, b) => b.rows.persons.length - a.rows.persons.length)[0]!;
    const out = process.env.CHART_BENCH_OUT;
    for (let round = 0; round < 3; round++) {
      const gathered = await timed(() => gatherDescendants(deps, { personId: biggest.f }, 9));
      const made = await timed(() =>
        descendantChart(gathered.value, { start: { personId: biggest.f }, generations: 8, form: 'tree', line: null, sheet: null }),
      );
      const sheet = await timed(() =>
        descendantChart(gathered.value, { start: { personId: biggest.f }, generations: 8, form: 'tree', line: null, sheet: 'reduced' }),
      );
      console.log(
        `Descendant chart, 8 generations: gather ${gathered.ms} ms, model ${made.ms} ms, Sheet model ${sheet.ms} ms; ${made.value.cards} cards, ${made.value.shown} generations shown, ${made.value.leftOut} left out`,
      );
      if (out && round === 0) writeFileSync(join(out, 'scale-descendants.json'), JSON.stringify(sheet.value));
      const deepest = made.value.nodes.filter((x) => !x.pointer).sort((a, b) => b.generation - a.generation)[0]!;
      // add-kinship task 8.1: kinship on every card for the deepest descendant as the reader (the link copy is built in round 0).
      if (made.value.sheet === null) {
        const persons = made.value.persons;
        const kinship = await timed(() => fillKinship(db, deepest.personId, persons));
        console.log(`Kinship on ${persons.length} cards: ${kinship.ms} ms${round === 0 ? ' (with the link copy built)' : ''}`);
      }
      const lineRows = await timed(() => gatherDescendants(deps, { personId: biggest.f }, 12));
      const line = await timed(() =>
        descendantChart(lineRows.value, { start: { personId: biggest.f }, generations: 4, form: 'line', line: deepest.personId, sheet: null }),
      );
      console.log(`Line form, ${line.value.rows.length} rows: gather ${lineRows.ms} ms (${lineRows.value.persons.length} Persons), model ${line.ms} ms`);
      const counts = new Map<string, number>();
      for (const e of model.events) if (e.houseId) counts.set(e.houseId, (counts.get(e.houseId) ?? 0) + 1);
      const busiest = [...counts].sort((a, b) => b[1] - a[1])[0]!;
      const houseRows = await timed(() => gatherHouse(deps, busiest[0]));
      const house = await timed(() => houseChart(houseRows.value!, { from: null, to: null, unrelated: true, sheet: null }));
      console.log(
        `House chart, ${busiest[1]} Events at the House: gather ${houseRows.ms} ms, model ${house.ms} ms; ${house.value.total} rows${house.value.needsPeriod ? ' (asks for a period)' : ''}`,
      );
      if (out && round === 0)
        writeFileSync(join(out, 'scale-house.json'), JSON.stringify(houseChart(houseRows.value!, { from: null, to: null, unrelated: true, sheet: 'reduced' })));
      expect(made.value.cards).toBeLessThanOrEqual(500);
    }
  });
});
