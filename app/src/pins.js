// The family on the map (family-map spec), as pure functions: pins from the map Events, pins
// grouped at low zoom, a Person's life path, the "Family here" list, and the decades of the
// year slider. src/family-map.js draws them with Leaflet.

/** @typedef {import('./types.js').MapEvent} MapEvent */
/** @typedef {import('./types.js').PlaceEvent} PlaceEvent */
/** @typedef {import('./types.js').PersonSummary} PersonSummary */
/** @typedef {import('./types.js').PersonDetail} PersonDetail */
/** @typedef {import('./types.js').EventType} EventType */
/** @typedef {import('./types.js').RoleType} RoleType */

export const YEAR_MIN = 1600;
export const YEAR_MAX = 1950;

/**
 * A pin: one Place or House with Events of the Tree.
 * @typedef {object} Pin
 * @property {string} key "house:<id>" or "place:<id>"
 * @property {string} placeId the Place, also of a House
 * @property {string} name the Place's name, with the house number for a House
 * @property {number} lat
 * @property {number} lon
 * @property {string[]} personIds the Persons with Events there, each once
 */

/**
 * One pin per Place or House: an Event at a House with its own location goes to the House,
 * any other to its Place.
 * @param {readonly MapEvent[]} events
 * @param {(person: { id: string }) => boolean} [shown] whether a Person counts (the relation filter)
 * @returns {Pin[]}
 */
export function pinsFromEvents(events, shown = () => true) {
  /** @type {Map<string, Pin & { ids: Set<string> }>} */
  const pins = new Map();
  for (const e of events) {
    const persons = e.persons.filter(shown);
    if (persons.length === 0 || !e.place) continue;
    const atHouse = e.house?.location ? e.house : null;
    const key = atHouse ? `house:${atHouse.id}` : `place:${e.place.id}`;
    let pin = pins.get(key);
    if (!pin) {
      const name = atHouse?.number ? `${e.place.name} čp. ${atHouse.number}` : e.place.name;
      pin = { key, placeId: e.place.id, name, lat: e.location.lat, lon: e.location.lon, personIds: [], ids: new Set() };
      pins.set(key, pin);
    }
    for (const p of persons) pin.ids.add(p.id);
  }
  return [...pins.values()].map(({ ids, ...pin }) => ({ ...pin, personIds: [...ids].sort() }));
}

/**
 * @typedef {object} Cluster
 * @property {Pin[]} pins
 * @property {number} lat the middle of its pins
 * @property {number} lon
 * @property {number} count Persons with Events at any of its pins, each once
 */

/**
 * Groups pins that are closer than `cell` pixels on screen at the current zoom, so a whole
 * country shows a few numbered groups and one district a pin per Place or House. `project`
 * gives a pin's position in pixels at the zoom shown.
 * @param {readonly Pin[]} pins
 * @param {(lat: number, lon: number) => { x: number, y: number }} project
 * @param {number} [cell]
 * @returns {Cluster[]}
 */
export function clusterPins(pins, project, cell = 56) {
  /** @type {Map<string, Pin[]>} */
  const cells = new Map();
  for (const pin of pins) {
    const { x, y } = project(pin.lat, pin.lon);
    const key = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
    const list = cells.get(key);
    if (list) list.push(pin);
    else cells.set(key, [pin]);
  }
  return [...cells.values()].map((group) => ({
    pins: group,
    lat: group.reduce((s, p) => s + p.lat, 0) / group.length,
    lon: group.reduce((s, p) => s + p.lon, 0) / group.length,
    count: new Set(group.flatMap((p) => p.personIds)).size,
  }));
}

/** The year an EDTF date starts with, or null. @param {string | null} date */
export function yearOf(date) {
  const m = date ? /\d{4}/.exec(date) : null;
  return m ? Number(m[0]) : null;
}

/**
 * @typedef {object} LifePoint
 * @property {string} placeId
 * @property {number} lat
 * @property {number} lon
 * @property {string} placeName
 * @property {number[]} years the years of the Events there, in order
 * @property {EventType[]} types
 */

/**
 * A Person's life path (family-map spec, "Life path"): the Events with a location in date
 * order, consecutive Events in the same Place (at its Houses or not) joined into one point.
 * Undated Events and Events without a location are left out.
 * @param {PersonDetail['events']} events in the order of the person page (earliest first)
 * @returns {LifePoint[]}
 */
export function lifePath(events) {
  /** @type {LifePoint[]} */
  const points = [];
  const dated = events
    .map((e) => ({ e: e.event, year: yearOf(e.event.date) }))
    .filter((x) => x.year !== null && (x.e.house?.location ?? x.e.place?.location))
    .sort((a, b) => (a.e.earliest ?? '').localeCompare(b.e.earliest ?? '') || /** @type {number} */ (a.year) - /** @type {number} */ (b.year));
  for (const { e, year } of dated) {
    const loc = /** @type {{ lat: number, lon: number }} */ (e.house?.location ?? e.place?.location);
    const placeId = e.place?.id ?? `${loc.lat},${loc.lon}`;
    const last = points[points.length - 1];
    if (last && last.placeId === placeId) {
      if (!last.years.includes(/** @type {number} */ (year))) last.years.push(/** @type {number} */ (year));
      last.types.push(e.type);
      continue;
    }
    points.push({ placeId, lat: loc.lat, lon: loc.lon, placeName: e.place?.name ?? '', years: [/** @type {number} */ (year)], types: [e.type] });
  }
  return points;
}

/**
 * @typedef {object} PersonHere
 * @property {PersonSummary} person
 * @property {{ id: string, type: EventType, role: RoleType, date: string | null, year: number | null, house: string | null }[]} events
 */

/**
 * "Family here": the Events of a Place grouped by Person, the Persons in the order of their
 * first Event there.
 * @param {readonly PlaceEvent[]} events earliest first
 * @param {(person: PersonSummary) => boolean} [shown] whether a Person counts (the relation filter)
 * @returns {PersonHere[]}
 */
export function familyHere(events, shown = () => true) {
  /** @type {Map<string, PersonHere>} */
  const byPerson = new Map();
  for (const e of events) {
    for (const { person, role } of e.persons) {
      if (!shown(person)) continue;
      let entry = byPerson.get(person.id);
      if (!entry) {
        entry = { person, events: [] };
        byPerson.set(person.id, entry);
      }
      entry.events.push({ id: e.id, type: e.type, role, date: e.date, year: yearOf(e.date), house: e.house?.number ?? null });
    }
  }
  return [...byPerson.values()];
}

/**
 * The decades the play control steps through: [1600, 1609], [1610, 1619] … up to `to`.
 * @param {number} from
 * @param {number} to
 * @returns {[number, number][]}
 */
export function decades(from = YEAR_MIN, to = YEAR_MAX) {
  /** @type {[number, number][]} */
  const out = [];
  for (let start = Math.floor(from / 10) * 10; start <= to; start += 10) out.push([start, Math.min(start + 9, to)]);
  return out;
}
