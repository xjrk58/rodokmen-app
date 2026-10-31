// add-family-view tasks 3.1–3.4: pins, grouping, the life path, "Family here" and the decades.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusterPins, decades, familyHere, lifePath, pinsFromEvents, yearOf } from '../../src/pins.js';
import { mapEvents, placeEvents } from '../e2e/family-api.js';
import { detail, P, PLACE } from '../e2e/family-data.js';

const WORLD = [-180, -85, 180, 85];

/** Web Mercator pixels at a zoom, as Leaflet projects them. @param {number} zoom */
const mercator = (zoom) => (/** @type {number} */ lat, /** @type {number} */ lon) => {
  const scale = 256 * 2 ** zoom;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
};

test('one pin per Place or House, counting each Person once', () => {
  const pins = pinsFromEvents(mapEvents(WORLD, 1600, 1950).events);
  const keys = pins.map((p) => p.key).sort();
  // Kamenná Lhota's House (čp. 12) and the Place itself, Vrbice, Dolní Kamenec and the village abroad.
  assert.equal(keys.filter((k) => k.startsWith('house:')).length, 1);
  assert.equal(keys.filter((k) => k.startsWith('place:')).length, 4);
  const house = pins.find((p) => p.key.startsWith('house:'));
  assert.equal(house?.name, 'Kamenná Lhota čp. 12');
  // Jan is at the House twice (baptism, death) and counts once.
  assert.equal(house?.personIds.filter((id) => id === P.jan).length, 1);
});

test('a filter on Persons drops pins with nobody shown', () => {
  const pins = pinsFromEvents(mapEvents(WORLD, 1600, 1950).events, (p) => p.id === P.antonin);
  assert.deepEqual(pins.map((p) => p.placeId).sort(), [PLACE.kamennaLhota, PLACE.vrbice, PLACE.dolniKamenec].sort());
});

test('zooming in: grouped pins split into one pin per Place or House', () => {
  const pins = pinsFromEvents(mapEvents(WORLD, 1600, 1950).events);
  const country = clusterPins(pins, mercator(7));
  const district = clusterPins(pins, mercator(13));
  assert.ok(country.length < pins.length, 'the whole country groups nearby pins');
  assert.equal(district.length, pins.length, 'one district shows every pin');
  for (const c of district) assert.equal(c.pins.length, 1);
  const group = country.find((c) => c.pins.length > 1);
  assert.ok(group);
  assert.equal(group.count, new Set(group.pins.flatMap((p) => p.personIds)).size);
});

test('one generation: a year range keeps only pins with Events in those years', () => {
  const pins = pinsFromEvents(mapEvents(WORLD, 1820, 1850).events);
  const events = mapEvents(WORLD, 1820, 1850).events;
  assert.ok(events.length > 0);
  for (const e of events) assert.ok((yearOf(e.date) ?? 0) >= 1820 && (yearOf(e.date) ?? 0) <= 1850);
  // Antonín's 1866 marriage and 1912 burial are outside; the 1801 baptism too.
  assert.equal(
    pins.some((p) => p.placeId === PLACE.dolniKamenec),
    false,
  );
});

test('moving between villages: born in one, married in a second, buried in a third, in that order with years', () => {
  const path = lifePath(detail(16).events);
  assert.deepEqual(
    path.map((p) => [p.placeName, p.years]),
    [
      ['Kamenná Lhota', [1840]],
      ['Vrbice', [1866]],
      ['Dolní Kamenec', [1912]],
    ],
  );
});

test('the life path joins consecutive Events in one Place, at its House or not, into one point', () => {
  const path = lifePath(detail(10).events);
  // Jan: baptised 1801 at the House, married 1825 in Vrbice, then 1829 (a daughter's baptism), 1837, 1840 and 1850 back home.
  assert.deepEqual(
    path.map((p) => [p.placeName, p.years]),
    [
      ['Kamenná Lhota', [1801]],
      ['Vrbice', [1825]],
      ['Kamenná Lhota', [1829, 1837, 1840, 1850]],
    ],
  );
});

test('Family here: the Events of a Place grouped by Person, with years', () => {
  const here = familyHere(placeEvents(PLACE.kamennaLhota).events);
  const jan = here.find((h) => h.person.id === P.jan);
  assert.ok(jan);
  assert.deepEqual(
    jan.events.map((e) => [e.type, e.role, e.year]),
    [
      ['baptism', 'child', 1801],
      ['baptism', 'father', 1829],
      ['marriage', 'partner', 1837],
      ['baptism', 'father', 1840],
      ['death', 'deceased', 1850],
    ],
  );
  const rozalie = here.find((h) => h.person.id === P.rozalie);
  assert.deepEqual(
    rozalie?.events.map((e) => e.role),
    ['godparent', 'godparent'],
  );
  assert.equal(here.length, new Set(placeEvents(PLACE.kamennaLhota).events.flatMap((e) => e.persons.map((p) => p.person.id))).size);
});

test('the play control steps through the decades from 1600 to 1950', () => {
  const steps = decades();
  assert.deepEqual(steps[0], [1600, 1609]);
  assert.deepEqual(steps[steps.length - 1], [1950, 1950]);
  assert.equal(steps.length, 36);
  assert.deepEqual(decades(1823, 1845), [
    [1820, 1829],
    [1830, 1839],
    [1840, 1845],
  ]);
});
