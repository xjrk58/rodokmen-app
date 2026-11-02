// A stand-in for the Tree API (/api/…) for tests of the work panel without a
// server. server/test/app-proposals.e2e.test.ts runs the same screens against
// the real server; these tests cover timing and failures that are hard to
// produce there: slow answers, lost answers, failing storage.

/** @typedef {import('../../src/types.js').Me} Me */
/** @typedef {import('../../src/types.js').ProposalView} ProposalView */
/** @typedef {import('../../src/types.js').PersonSearchHit} PersonSearchHit */
/** @typedef {import('../../src/types.js').PersonDetail} PersonDetail */

/**
 * @typedef {object} Reply
 * @property {number} [status] default 200
 * @property {unknown} [json]
 * @property {boolean} [abort] drop the connection instead of answering
 */
/** @typedef {Reply | ((request: import('@playwright/test').Request) => Reply | Promise<Reply>)} Handler */
/** @typedef {{ key: string, body: unknown }} Call */

/**
 * Answers /api/ requests from handlers keyed "METHOD path?query" (or "METHOD path"
 * for any query); anything else gets 404. Returns the calls made, in order.
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, Handler>} handlers
 * @returns {Promise<Call[]>}
 */
export async function mockApi(page, handlers) {
  /** @type {Call[]} */
  const calls = [];
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.slice('/api/'.length);
      const key = `${request.method()} ${path}${url.search}`;
      /** @type {unknown} */
      const body = request.postData() ? JSON.parse(request.postData() ?? 'null') : null;
      calls.push({ key, body });
      const handler = handlers[key] ?? handlers[`${request.method()} ${path}`];
      if (!handler) return route.fulfill({ status: 404, json: { code: 'not_found', message: `No mock for ${key}` } });
      const reply = typeof handler === 'function' ? await handler(request) : handler;
      // The page may have dropped the request meanwhile (a screen it left); then there is nobody to answer.
      if (reply.abort) return route.abort('connectionreset').catch(() => undefined);
      return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? null }).catch(() => undefined);
    },
  );
  return calls;
}

/**
 * Resolves when a request whose URL contains `part` ends, answered or dropped.
 * Set it up before the request is made.
 * @param {import('@playwright/test').Page} page
 * @param {string} part
 * @returns {Promise<void>}
 */
export function settled(page, part) {
  return new Promise((resolve) => {
    /** @param {import('@playwright/test').Request} request */
    const done = (request) => {
      if (request.url().includes(part)) resolve();
    };
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  });
}

/** A promise the test resolves when it wants a slow answer to arrive. */
export function gate() {
  /** @type {() => void} */
  let open = () => {};
  /** @type {Promise<void>} */
  const opened = new Promise((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

const ID = (/** @type {number} */ n) => `0192f0c4-7a1e-7c3b-9d2a-${String(n).padStart(12, '0')}`;
export { ID };

/**
 * @param {'contributor' | 'editor'} role
 * @returns {Me}
 */
export function me(role) {
  const editor = role === 'editor';
  return {
    id: ID(900),
    version: 1,
    email: 'member@example.test',
    displayName: editor ? 'Eva Editor' : 'Karel Contributor',
    language: 'en',
    role,
    permissions: {
      propose: true,
      writeLeads: true,
      decideSuggestions: true,
      review: editor,
      inviteMembers: editor,
      changeRoles: false,
      disableMembers: false,
      markFamilyRoots: false,
    },
    passkeyCount: 1,
    person: null,
    familyRoots: [],
  };
}

/**
 * A Person search hit.
 * @param {number} n
 * @param {string} given
 * @param {string} surname
 * @param {string | null} [birth]
 * @returns {PersonSearchHit}
 */
export function personHit(n, given, surname, birth = null) {
  return {
    person: {
      id: ID(n),
      version: 1,
      sex: 'unknown',
      given,
      surname,
      displayName: `${given} ${surname}`,
      living: false,
      birth,
      death: null,
      relation: 'unrelated',
      familyRoot: false,
    },
    matchedName: `${given} ${surname}`,
  };
}

/**
 * A Person with one Name and no Events.
 * @param {number} n
 * @param {string} given
 * @param {string} surname
 * @returns {PersonDetail}
 */
export function personDetail(n, given, surname) {
  return {
    id: ID(n),
    version: 1,
    sex: 'unknown',
    living: false,
    relation: 'unrelated',
    familyRoot: false,
    names: [
      {
        id: ID(n + 1000),
        version: 1,
        personId: ID(n),
        given,
        surname,
        type: 'birth',
        language: 'cs',
        asFound: `${given} ${surname}`,
        primary: true,
        citations: [],
      },
    ],
    events: [],
    familiesAsPartner: [],
    familiesAsChild: [],
    portraits: [],
  };
}

/**
 * A pending Proposal that corrects an Event date edited since by someone else.
 * @returns {ProposalView}
 */
export function conflictingProposal() {
  const event = ID(300);
  return {
    id: ID(400),
    version: 1,
    kind: 'contribution',
    status: 'pending',
    author: { id: ID(901), displayName: 'Karel Contributor', isAgent: false },
    note: 'The date is in the register',
    submittedAt: '2026-10-20T10:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
    undoes: null,
    undoneBy: null,
    operations: [
      {
        position: 0,
        operation: { op: 'setField', record: 'event', id: event, baseVersion: 1, set: { date: '1850-11-03' } },
        summary: { cs: 'mění datum úmrtí', en: 'changes the date of the death' },
        corrected: false,
        original: null,
        originalSummary: null,
        current: { date: '1851' },
        conflict: {
          record: 'event',
          id: event,
          label: { cs: 'úmrtí', en: 'the death' },
          baseVersion: 1,
          currentVersion: 2,
          fields: [{ field: 'date', proposed: '1850-11-03', current: '1851' }],
        },
      },
      {
        position: 1,
        operation: {
          op: 'createCitation',
          tempId: 'tmp:c',
          sourceId: ID(301),
          page: '41',
          transcription: 'obiit 3. Novembris',
          readOn: '2026-10-20',
          confidence: 'high',
          note: null,
        },
        summary: { cs: 'cituje stranu 41', en: 'cites page 41' },
        corrected: false,
        original: null,
        originalSummary: null,
        current: null,
        conflict: null,
      },
    ],
    citations: [],
    conflicts: 1,
    answersLeads: [],
  };
}

/**
 * A search answer with these Places.
 * @param {...string} names
 * @returns {import('../../src/types.js').PlaceSearchResult}
 */
export function places(...names) {
  return { items: names.map((name, i) => ({ id: ID(200 + i), version: 1, type: 'village', name, location: null, municipality: null })), limit: 8, offset: 0 };
}

/**
 * A search answer with one Source of this type.
 * @param {string} title
 * @param {import('../../src/types.js').SourceType} type
 * @returns {import('../../src/types.js').SourceSearchResult}
 */
export function sources(title, type) {
  return {
    items: [{ id: ID(250), version: 1, type, title, repository: null, reference: null, url: null, familyAccount: null, register: null }],
    limit: 8,
    offset: 0,
  };
}

/** The answer to a submitted Proposal. @param {string} id @returns {ProposalView} */
export function submitted(id) {
  return { ...conflictingProposal(), id, operations: [], conflicts: 0 };
}

/** Signed out: the API answers 401. */
export const SIGNED_OUT = { status: 401, json: { code: 'unauthorized', message: 'Sign in first' } };
