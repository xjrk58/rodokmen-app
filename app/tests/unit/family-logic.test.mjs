// add-family-view: the addresses, the focus fallback order, the relation stand-in and the
// cache's eviction order, as pure functions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CACHE_LIMIT, toEvict } from '../../src/cache.js';
import { chooseFocus, clampDepth } from '../../src/focus.js';
import { familyRoots, isShown, relationKnown, relationOf } from '../../src/relation.js';
import { lifeAddress, needsMember, parseRoute, personAddress, treeAddress } from '../../src/routes.js';
import { P, summary } from '../e2e/family-data.js';

test('addresses: the tree focus is #person-<id>, and every screen has its own', () => {
  assert.deepEqual(parseRoute(''), { screen: 'home' });
  assert.deepEqual(parseRoute('#'), { screen: 'home' });
  assert.deepEqual(parseRoute(treeAddress(P.jan)), { screen: 'tree', focus: P.jan });
  assert.deepEqual(parseRoute(`#person-${P.jan.toUpperCase()}`), { screen: 'tree', focus: P.jan });
  assert.deepEqual(parseRoute('#tree'), { screen: 'tree', focus: null });
  assert.deepEqual(parseRoute('#people'), { screen: 'people' });
  assert.deepEqual(parseRoute(personAddress(P.jan)), { screen: 'person', id: P.jan });
  assert.deepEqual(parseRoute('#settings'), { screen: 'settings' });
  assert.deepEqual(parseRoute('#map'), { screen: 'map', life: null });
  assert.deepEqual(parseRoute('#map=9/49.75/15.5'), { screen: 'map', life: null });
  assert.deepEqual(parseRoute(lifeAddress(P.antonin)), { screen: 'map', life: P.antonin });
  assert.deepEqual(parseRoute('#sign-in'), { screen: 'sign-in' });
  assert.deepEqual(parseRoute('#invite/abcdefghijklmnopqrstuvwxyz_-0123'), { screen: 'invite', token: 'abcdefghijklmnopqrstuvwxyz_-0123' });
  assert.deepEqual(parseRoute('#link/abcdefghijklmnopqrstuvwxyz_-0123'), { screen: 'link', token: 'abcdefghijklmnopqrstuvwxyz_-0123' });
  assert.deepEqual(parseRoute('#work/review/x'), { screen: 'work', view: 'review' });
  assert.deepEqual(parseRoute('#work'), { screen: 'work', view: 'propose' });
  for (const odd of ['#person-123', '#people/x', '#invite/short', '#elsewhere']) assert.deepEqual(parseRoute(odd), { screen: 'home' }, odd);
});

test('family screens need a signed-in Member; the map, signing in and the work panel do not', () => {
  for (const hash of [treeAddress(P.jan), '#tree', '#people', personAddress(P.jan), '#settings', lifeAddress(P.jan)])
    assert.equal(needsMember(parseRoute(hash)), true, hash);
  for (const hash of ['', '#map', '#map=9/49.75/15.5', '#sign-in', '#work/propose']) assert.equal(needsMember(parseRoute(hash)), false, hash);
});

test('focus: the address, then the remembered focus, then the own Person, then a Family root, else search', () => {
  const all = { address: P.jan, remembered: P.karel, own: P.dorota, roots: [P.vaclav] };
  assert.deepEqual(chooseFocus(all), { kind: 'person', id: P.jan, from: 'address' });
  assert.deepEqual(chooseFocus({ ...all, address: null }), { kind: 'person', id: P.karel, from: 'remembered' });
  // New Member: the Owner linked them and nothing is remembered.
  assert.deepEqual(chooseFocus({ ...all, address: null, remembered: null }), { kind: 'person', id: P.dorota, from: 'own' });
  // Not linked: a Family root.
  assert.deepEqual(chooseFocus({ address: null, remembered: null, own: null, roots: [P.vaclav] }), { kind: 'person', id: P.vaclav, from: 'root' });
  // No Family root exists yet (add-vault-import): search.
  assert.deepEqual(chooseFocus({ address: null, remembered: null, own: null, roots: [] }), { kind: 'search' });
});

test('depth stays within 1 to 6', () => {
  assert.equal(clampDepth(0, 3), 1);
  assert.equal(clampDepth(9, 3), 6);
  assert.equal(clampDepth(4, 3), 4);
  assert.equal(clampDepth('4', 3), 3);
  assert.equal(clampDepth(2.5, 2), 2);
});

test('relation: until add-vault-import computes it, everyone is shown and there are no Family roots', () => {
  const p = summary(10);
  assert.equal(relationOf(p), null);
  assert.equal(isShown(p, false), true);
  assert.equal(relationKnown([p, summary(7)]), false);
  assert.deepEqual(familyRoots(null), []);
  // Once Persons carry a relation, Unrelated people are hidden unless switched on.
  const unrelated = { ...p, relation: 'unrelated' };
  assert.equal(relationOf(unrelated), 'unrelated');
  assert.equal(isShown(unrelated, false), false);
  assert.equal(isShown(unrelated, true), true);
  assert.equal(isShown({ ...p, relation: 'possible' }, false), true);
  assert.equal(relationKnown([p, unrelated]), true);
});

test('the cache keeps at most its limit, dropping the least recently used first', () => {
  assert.deepEqual(toEvict([{ key: 'a', usedAt: 1 }], 2), []);
  assert.deepEqual(
    toEvict(
      [
        { key: 'new', usedAt: 30 },
        { key: 'old', usedAt: 10 },
        { key: 'mid', usedAt: 20 },
      ],
      1,
    ),
    ['old', 'mid'],
  );
  assert.ok(CACHE_LIMIT >= 100);
});
