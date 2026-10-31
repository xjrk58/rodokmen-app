// The mocked Tree API for the family screens' browser tests: answers search, the map and
// "Family here" from the invented Tree in family-data.js, as the server would.

import { detail, EVENTS, eventSummary, hourglass, ID, numberOf, PEOPLE, placeRef, summary } from './family-data.js';

/** @typedef {import('../../src/types.js').MapEventsResult} MapEventsResult */
/** @typedef {import('../../src/types.js').PlaceEvents} PlaceEvents */
/** @typedef {import('../../src/types.js').PersonSearchResult} PersonSearchResult */

/**
 * Person search, ignoring case and diacritics, as GET /api/persons answers it.
 * @param {string} q
 * @returns {PersonSearchResult}
 */
export function search(q) {
  const fold = (/** @type {string} */ s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const words = fold(q).split(/\s+/).filter(Boolean);
  const items = PEOPLE.flatMap(([n, , given, surname, , , others = []]) => {
    const names = [`${given} ${surname}`, ...others];
    const matched = names.find((name) => words.every((w) => fold(name).includes(w)));
    return matched ? [{ person: summary(n), matchedName: matched }] : [];
  });
  return { items, limit: 50, offset: 0 };
}

/**
 * Map Events in an area and year range, as GET /api/map/events answers it.
 * @param {number[]} bbox minLon, minLat, maxLon, maxLat
 * @param {number} from
 * @param {number} to
 * @returns {MapEventsResult}
 */
export function mapEvents(bbox, from, to) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const events = EVENTS.map((e) => ({ e, s: eventSummary(e) })).filter(({ s }) => {
    const year = Number(s.date?.slice(0, 4));
    const loc = s.house?.location ?? s.place?.location;
    return loc && year >= from && year <= to && loc.lon >= minLon && loc.lon <= maxLon && loc.lat >= minLat && loc.lat <= maxLat;
  });
  return {
    truncated: false,
    events: events.map(({ e, s }) => ({
      id: s.id,
      version: 1,
      type: s.type,
      date: s.date,
      earliest: s.earliest,
      latest: s.latest,
      location: /** @type {{ lat: number, lon: number }} */ (s.house?.location ?? s.place?.location),
      place: s.place,
      house: s.house,
      persons: e[5].map(([n, role]) => ({ id: ID(n), displayName: summary(n).displayName, role })),
    })),
  };
}

/**
 * Family here: the Events of a Place, as GET /api/places/:id/events answers it.
 * @param {string} placeId
 * @returns {PlaceEvents}
 */
export function placeEvents(placeId) {
  const n = numberOf(placeId);
  return {
    place: placeRef(n),
    truncated: false,
    events: EVENTS.filter((e) => e[3] === n)
      .map((e) => ({ ...eventSummary(e), persons: e[5].map(([p, role]) => ({ role, roleDetail: null, person: summary(p) })) }))
      .sort((a, b) => a.earliest.localeCompare(b.earliest)),
  };
}

/** @typedef {import('../../src/types.js').Me} Me */
/** @typedef {{ status?: number, json?: unknown }} Reply */
/** @typedef {(match: RegExpExecArray, url: URL, body: unknown) => Reply | Promise<Reply>} Handler */

/**
 * A signed-in Member of the invented Tree.
 * @param {'contributor' | 'editor' | 'owner'} role
 * @param {{ person?: number | null, language?: 'cs' | 'en' }} [o] person: the Member's own Person
 * @returns {Me}
 */
export function member(role, o = {}) {
  return {
    id: ID(900),
    version: 1,
    email: 'eliska@example.test',
    displayName: 'Eliška Invented',
    language: o.language ?? 'en',
    role,
    permissions: {
      propose: true,
      review: role !== 'contributor',
      inviteMembers: role === 'owner',
      changeRoles: role === 'owner',
      disableMembers: role === 'owner',
    },
    passkeyCount: 1,
    person: o.person ? summary(o.person) : null,
  };
}

/**
 * Answers the Tree API from the invented Tree; `extra` handlers (by "METHOD path" regex source)
 * come first. Anything else gets 404. Returns the requests made, as "METHOD path?query".
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} target
 * @param {{ me: Me | null, extra?: Record<string, Handler> }} o
 */
export async function mockFamilyApi(target, o) {
  /** @type {string[]} */
  const calls = [];
  /** @type {[RegExp, Handler][]} */
  const routes = [
    ...Object.entries(o.extra ?? {}).map(([k, h]) => /** @type {[RegExp, Handler]} */ ([new RegExp(`^${k}$`), h])),
    [/^GET me$/, () => (o.me ? { json: o.me } : { status: 401, json: { code: 'unauthorized', message: 'Sign in to continue.' } })],
    [
      /^GET persons\/([0-9a-f-]+)\/hourglass$/,
      (m, url) => ({ json: hourglassFor(m[1], Number(url.searchParams.get('up')), Number(url.searchParams.get('down'))) }),
    ],
    [/^GET persons\/([0-9a-f-]+)$/, (m) => ({ json: detail(numberOf(m[1])) })],
    [/^GET persons$/, (_m, url) => ({ json: { ...search(url.searchParams.get('q') ?? ''), limit: Number(url.searchParams.get('limit') ?? 50) } })],
    [
      /^GET map\/events$/,
      (_m, url) => ({
        json: mapEvents((url.searchParams.get('bbox') ?? '').split(',').map(Number), Number(url.searchParams.get('from')), Number(url.searchParams.get('to'))),
      }),
    ],
    [/^GET places\/([0-9a-f-]+)\/events$/, (m) => ({ json: placeEvents(m[1]) })],
    [/^GET citations\/([0-9a-f-]+)$/, (m) => ({ json: citation(m[1]) })],
    [/^GET me\/sessions$/, () => ({ json: { items: [] } })],
    [/^GET me\/passkeys$/, () => ({ json: { items: [] } })],
    [/^GET me\/notifications$/, () => ({ json: { outcomeEmails: true } })],
  ];
  await target.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const key = `${request.method()} ${url.pathname.slice('/api/'.length)}`;
      calls.push(`${key}${url.search}`);
      /** @type {unknown} */
      const body = request.postData() ? JSON.parse(request.postData() ?? 'null') : null;
      for (const [pattern, handler] of routes) {
        const m = pattern.exec(key);
        if (!m) continue;
        const reply = await handler(m, url, body);
        return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? null }).catch(() => undefined);
      }
      return route.fulfill({ status: 404, json: { code: 'not_found', message: `No mock for ${key}` } }).catch(() => undefined);
    },
  );
  return calls;
}

/** @param {string} id @param {number} up @param {number} down */
function hourglassFor(id, up, down) {
  return hourglass(id, up || 3, down || 2);
}

/** A Citation of the invented register, with its transcription and one page image. @param {string} id */
function citation(id) {
  return {
    id,
    version: 1,
    sourceId: ID(501),
    page: '41',
    transcription: 'Joannes, filius legitimus, natus 12. Martii',
    readOn: '2026-10-01',
    confidence: 'high',
    note: null,
    source: {
      id: ID(501),
      version: 1,
      type: 'parish_register',
      title: 'Invented register 1784–1830',
      repository: null,
      reference: null,
      url: null,
      familyAccount: null,
    },
    events: [],
    names: [],
    images: [
      {
        id: ID(700),
        version: 1,
        kind: 'page',
        citationId: id,
        personIds: [],
        contentType: 'image/png',
        byteSize: 100,
        width: 1,
        height: 1,
        sha256: 'a'.repeat(64),
        caption: 'Register page (invented)',
        url: 'https://storage.example.test/page.png',
        urlExpiresAt: '2026-10-30T12:00:00.000Z',
      },
    ],
  };
}
