// Rodokmen service worker (an ES module).
//
// - The app shell and app/data/ are precached under VERSION and served cache
//   first, so the map, search and archive lookup work offline after one visit.
// - Map tiles are cached only as the reader views them, in their own cache of
//   at most TILE_CACHE_LIMIT tiles; the least recently used go first.
// - A new version installs in the background and waits until the page asks it
//   to take over (the reader tapped "New version, reload").

import { PRECACHE } from './src/precache.js';
import { TILE_CACHE_LIMIT, TileLru } from './src/tile-lru.js';

/** Written by scripts/stamp-version.mjs; changes whenever a precached file changes. */
const VERSION = '0.1.0+5abf8f8b62';

const SHELL_PREFIX = 'rodokmen-shell-';
const SHELL_CACHE = `${SHELL_PREFIX}${VERSION}`;
const TILE_CACHE = 'rodokmen-tiles';
const META_CACHE = 'rodokmen-meta';
/** Slippy-map tile paths: /z/x/y.png */
const TILE_PATH = /\/\d+\/\d+\/\d+(?:@2x)?\.png$/;
const SAVE_DELAY_MS = 1000;

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const scope = sw.registration.scope;
const LRU_KEY = new URL('__tile-lru__.json', scope).href;

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // cache: 'reload' skips the HTTP cache, so a release never mixes in older files.
      cache.addAll(PRECACHE.map((path) => new Request(new URL(path, scope), { cache: 'reload' })))),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // The API and the sign-in pages always go to the network (same origin, ADR 0007).
  if (url.href.startsWith(new URL('api/', scope).href) || url.href.startsWith(new URL('auth/', scope).href)) return;
  if (url.href.startsWith(scope)) {
    event.respondWith(request.mode === 'navigate' ? shellPage(request) : shellFile(request));
  } else if (url.origin !== sw.location.origin && TILE_PATH.test(url.pathname)) {
    event.respondWith(tile(event));
  }
});

/** @param {Request} request */
async function shellPage(request) {
  const cache = await caches.open(SHELL_CACHE);
  return (await cache.match(new URL('index.html', scope).href)) ?? fetch(request);
}

/** @param {Request} request */
async function shellFile(request) {
  const cache = await caches.open(SHELL_CACHE);
  return (await cache.match(request, { ignoreSearch: true })) ?? fetch(request);
}

// ---- Tile cache with least-recently-used eviction ----

/** @type {Promise<TileLru> | null} */
let lruPromise = null;

/** The use order of cached tiles, kept in META_CACHE across worker restarts. */
function tileIndex() {
  lruPromise ??= (async () => {
    const [meta, tiles] = await Promise.all([caches.open(META_CACHE), caches.open(TILE_CACHE)]);
    const saved = await meta.match(LRU_KEY);
    /** @type {string[]} */
    const order = saved ? await saved.json() : [];
    const present = new Set((await tiles.keys()).map((r) => r.url));
    const known = order.filter((u) => present.has(u));
    const knownSet = new Set(known);
    // Tiles cached but missing from the saved order count as the oldest.
    const unknown = [...present].filter((u) => !knownSet.has(u));
    const index = new TileLru(TILE_CACHE_LIMIT, [...unknown, ...known]);
    await Promise.all(index.trim().map((u) => tiles.delete(u)));
    return index;
  })();
  return lruPromise;
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let saveTimer;
/** @type {Promise<void> | null} */
let pendingSave = null;
/** @type {(() => void) | null} */
let resolveSave = null;

/**
 * Writes the use order soon; bursts of tile requests share one write.
 * @param {TileLru} index
 * @returns {Promise<void>}
 */
function saveIndexSoon(index) {
  clearTimeout(saveTimer);
  pendingSave ??= new Promise((resolve) => {
    resolveSave = resolve;
  });
  saveTimer = setTimeout(async () => {
    const done = resolveSave;
    pendingSave = null;
    resolveSave = null;
    try {
      const meta = await caches.open(META_CACHE);
      await meta.put(LRU_KEY, new Response(JSON.stringify(index.keys()), { headers: { 'content-type': 'application/json' } }));
    } finally {
      done?.();
    }
  }, SAVE_DELAY_MS);
  return pendingSave;
}

/** @param {FetchEvent} event */
async function tile(event) {
  const { request } = event;
  const [tiles, index] = await Promise.all([caches.open(TILE_CACHE), tileIndex()]);
  const cached = await tiles.match(request);
  if (cached) {
    index.touch(request.url);
    event.waitUntil(saveIndexSoon(index));
    return cached;
  }
  const response = await fetch(request);
  // Opaque responses are skipped: their size is unknown and they may be errors.
  if (response.ok && response.type !== 'opaque') {
    const copy = response.clone();
    event.waitUntil(
      (async () => {
        try {
          await tiles.put(request, copy);
        } catch {
          return; // storage full: serve the tile without caching it
        }
        const evicted = index.touch(request.url);
        await Promise.all(evicted.map((u) => tiles.delete(u)));
        await saveIndexSoon(index);
      })(),
    );
  }
  return response;
}
