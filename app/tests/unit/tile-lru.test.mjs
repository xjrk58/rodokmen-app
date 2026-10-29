// Task 6.3: the tile cache keeps at most its capacity and drops the least
// recently used tiles first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TILE_CACHE_LIMIT, TileLru } from '../../src/tile-lru.js';

test('the limit is 2,000 tiles', () => {
  assert.equal(TILE_CACHE_LIMIT, 2000);
});

test('evicts the least recently used key first', () => {
  const lru = new TileLru(3);
  assert.deepEqual(lru.touch('a'), []);
  assert.deepEqual(lru.touch('b'), []);
  assert.deepEqual(lru.touch('c'), []);
  assert.deepEqual(lru.touch('a'), []); // a is used again: b is now the oldest
  assert.deepEqual(lru.touch('d'), ['b']);
  assert.deepEqual(lru.keys(), ['c', 'a', 'd']);
  assert.deepEqual(lru.touch('e'), ['c']);
  assert.deepEqual(lru.touch('a'), []);
  assert.deepEqual(lru.touch('f'), ['d']);
  assert.deepEqual(lru.keys(), ['e', 'a', 'f']);
});

test('a read counts as a use', () => {
  const lru = new TileLru(2, ['old', 'new']);
  lru.touch('old');
  assert.deepEqual(lru.touch('third'), ['new']);
});

test('never holds more than its capacity, evicting in use order', () => {
  const lru = new TileLru(TILE_CACHE_LIMIT);
  /** @type {string[]} */
  const evicted = [];
  for (let i = 0; i < 2500; i++) evicted.push(...lru.touch(`tile/${i}`));
  assert.equal(lru.size, 2000);
  assert.deepEqual(evicted, Array.from({ length: 500 }, (_, i) => `tile/${i}`));
  assert.equal(lru.keys()[0], 'tile/500');
});

test('a restored index over capacity trims the oldest', () => {
  const lru = new TileLru(2, ['x', 'y', 'z']);
  assert.deepEqual(lru.trim(), ['x']);
  assert.deepEqual(lru.keys(), ['y', 'z']);
});
