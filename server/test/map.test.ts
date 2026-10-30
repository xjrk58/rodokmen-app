import { MapEventsResult, overlapsYears, parseEdtf } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../src/fixture/generate.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

const model = generateFixture();
const L = model.landmarks;

/** Map area around Kamenná Lhota, Dolní Kamenec, Vrbice and Zálesí; Horní Bukovina and Lomnice lie outside. */
const BBOX = { minLon: 15.82, minLat: 49.88, maxLon: 16.02, maxLat: 50.01 };
const bboxParam = `${BBOX.minLon},${BBOX.minLat},${BBOX.maxLon},${BBOX.maxLat}`;

function locationOf(event: (typeof model.events)[number]) {
  if (event.houseId) {
    const h = model.houses.find((x) => x.id === event.houseId)!;
    return h.location ?? model.places.find((p) => p.id === h.placeId)!.location;
  }
  if (event.placeId) return model.places.find((p) => p.id === event.placeId)!.location;
  return null;
}

const inside = (p: { lat: number; lon: number } | null) =>
  p !== null && p.lon >= BBOX.minLon && p.lon <= BBOX.maxLon && p.lat >= BBOX.minLat && p.lat <= BBOX.maxLat;

describe('Events for the map', () => {
  let t: TestDatabase;
  let a: TestApp;
  let cookie: string;
  const query = async (q: string) => {
    const res = await a.app.inject({ method: 'GET', url: `/api/map/events?${q}`, headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    return MapEventsResult.parse(res.json());
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    await ensureOwner(t.db);
    cookie = await signIn(t.db, a.clock, await createMember(t.db));
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('map pins for a decade: only Events of 1840–1850 whose Place or House lies in the view', async () => {
    const result = await query(`bbox=${bboxParam}&from=1840&to=1850`);
    const expected = model.events.filter((e) => e.date !== null && overlapsYears(parseEdtf(e.date), 1840, 1850) && inside(locationOf(e))).map((e) => e.id);
    expect(result.truncated).toBe(false);
    expect(result.events.map((e) => e.id).sort()).toEqual(expected.sort());
    expect(expected.length).toBeGreaterThan(5);
    expect(result.events.map((e) => e.id)).toContain(L.event1840);
    expect(result.events.map((e) => e.id)).toContain(L.janDeath);
    for (const e of result.events) {
      expect(inside(e.location)).toBe(true);
      expect(overlapsYears(parseEdtf(e.date!), 1840, 1850)).toBe(true);
      expect(e.persons.length).toBeGreaterThan(0);
    }
  });

  it('leaves out Events of the period outside the view, and Events in the view outside the period', async () => {
    // Events of 1840–1850 exist in Horní Bukovina, outside the box.
    const outside = model.events.filter(
      (e) => e.date !== null && overlapsYears(parseEdtf(e.date), 1840, 1850) && !inside(locationOf(e)) && locationOf(e) !== null,
    );
    expect(outside.length).toBeGreaterThan(0);
    const result = await query(`bbox=${bboxParam}&from=1840&to=1850`);
    const ids = new Set(result.events.map((e) => e.id));
    for (const e of outside) expect(ids.has(e.id)).toBe(false);
    // Jan's 1801 baptism is in the box but not in the decade.
    expect(ids.has(L.janBaptism)).toBe(false);
    expect((await query(`bbox=${bboxParam}&from=1801&to=1801`)).events.map((e) => e.id)).toContain(L.janBaptism);
  });

  it('gives each pin its House with the number of that time, and the Persons with their Roles', async () => {
    const result = await query(`bbox=${bboxParam}&from=1850&to=1850`);
    const death = result.events.find((e) => e.id === L.janDeath)!;
    expect(death.house).toMatchObject({ id: L.houseA, number: '15' });
    expect(death.persons.find((p) => p.id === L.janNovak)?.role).toBe('deceased');
    expect(death.place?.name).toBe('Kamenná Lhota');
  });

  it('caps the number of pins and says so', async () => {
    const result = await query(`bbox=${bboxParam}&from=1750&to=1950&limit=10`);
    expect(result.events).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it('refuses a malformed map area', async () => {
    const res = await a.app.inject({ method: 'GET', url: '/api/map/events?bbox=15,49,16&from=1840&to=1850', headers: { cookie } });
    expect(res.statusCode).toBe(400);
  });
});
