// add-family-view task 2a.2: the hourglass layout, on the invented Tree of the browser tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOX, layoutHourglass, lifeYears } from '../../src/hourglass-layout.js';
import { hourglass, P } from '../e2e/family-data.js';

/** @param {import('../../src/hourglass-layout.js').Layout} layout @param {string} id */
const node = (layout, id) => {
  const n = layout.nodes.find((x) => x.id === id);
  assert.ok(n, `no box for ${id}`);
  return n;
};
/** @param {{ x: number }} n */
const centre = (n) => n.x + BOX.w / 2;

/** @param {import('../../src/hourglass-layout.js').Layout} layout */
function assertNoOverlap(layout) {
  const { nodes } = layout;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const apart = a.x + BOX.w <= b.x || b.x + BOX.w <= a.x || a.y + BOX.h <= b.y || b.y + BOX.h <= a.y;
      assert.ok(apart, `${a.person.displayName} and ${b.person.displayName} overlap`);
    }
  }
  assert.equal(new Set(nodes.map((n) => n.id)).size, nodes.length, 'every Person is drawn once');
}

test('the focus Person is centred on x = 0 in the middle row, ancestors above, descendants below', () => {
  const layout = layoutHourglass(hourglass(P.jan, 3, 2));
  const focus = node(layout, P.jan);
  assert.equal(centre(focus), 0);
  assert.equal(focus.y, 0);
  assert.equal(focus.kind, 'focus');
  for (const n of layout.nodes) {
    if (n.kind === 'ancestor') assert.ok(n.y < 0, `${n.person.displayName} is above`);
    if (n.kind === 'descendant') assert.ok(n.y > 0, `${n.person.displayName} is below`);
  }
  assertNoOverlap(layout);
});

test('second marriage: both partners beside the focus, each with their own children below', () => {
  const layout = layoutHourglass(hourglass(P.jan, 1, 1));
  const first = node(layout, P.katerina);
  const second = node(layout, P.ludmila);
  assert.equal(first.y, 0);
  assert.equal(second.y, 0);
  // One partner on each side.
  assert.ok(centre(first) < 0 && centre(second) > 0);
  const childrenOf = (/** @type {string[]} */ ids) => ids.map((id) => centre(node(layout, id)));
  const firstChildren = childrenOf([P.karel]);
  const secondChildren = childrenOf([P.antonin]);
  assert.ok(Math.max(...firstChildren) < Math.min(...secondChildren), "the first marriage's children are on its side");
  // A line from each couple down to its children.
  assert.ok(layout.lines.some((l) => l.key === `parents:${'0192f0c4-7a1e-7c3b-9d2a-000000000106'}`));
  assert.ok(layout.lines.some((l) => l.key === `parents:${'0192f0c4-7a1e-7c3b-9d2a-000000000107'}`));
  assertNoOverlap(layout);
});

test('ancestors: the father above the mother, the father’s parents to the left of the mother’s', () => {
  const layout = layoutHourglass(hourglass(P.jan, 3, 1));
  const father = node(layout, P.tomas);
  const mother = node(layout, P.marieSvobodova);
  assert.equal(father.x, mother.x);
  assert.ok(father.y < mother.y);
  assert.ok(mother.y + BOX.h < 0);
  assert.equal(centre(father), 0);
  assert.ok(centre(node(layout, P.vaclav)) < centre(node(layout, '0192f0c4-7a1e-7c3b-9d2a-000000000004')));
  // Three generations up hold four couples at most, which fit a 390 px phone.
  const top = layout.nodes.filter((n) => n.generation === 3);
  assert.ok(Math.max(...top.map((n) => n.x + BOX.w)) - Math.min(...top.map((n) => n.x)) <= 380);
  assertNoOverlap(layout);
});

test('deeper ancestry: 5 generations up draw the great-great-great-grandparents, where known', () => {
  const layout = layoutHourglass(hourglass(P.jan, 5, 1));
  // Above Jan: Tomáš, Václav, Prokop, Vojtěch and, five generations up, Šimon.
  const simon = node(layout, '0192f0c4-7a1e-7c3b-9d2a-000000000027');
  assert.equal(simon.generation, 5);
  assert.ok(simon.y < node(layout, '0192f0c4-7a1e-7c3b-9d2a-000000000026').y);
  assert.ok(node(layout, '0192f0c4-7a1e-7c3b-9d2a-000000000026').y < node(layout, P.prokop).y);
  assert.equal(
    layoutHourglass(hourglass(P.jan, 3, 1)).nodes.some((n) => n.generation > 3),
    false,
  );
  assertNoOverlap(layout);
});

test('moving up a line: a great-grandmother as the focus has her parents above and descendants below', () => {
  const layout = layoutHourglass(hourglass(P.marieSvobodova, 3, 2));
  assert.equal(node(layout, P.marieSvobodova).kind, 'focus');
  assert.ok(node(layout, '0192f0c4-7a1e-7c3b-9d2a-000000000005').y < 0);
  assert.ok(node(layout, P.jan).y > 0);
  assert.ok(node(layout, P.karel).y > node(layout, P.jan).y);
  assertNoOverlap(layout);
});

test('adoption: the birth parents are drawn, the adoptive parents are named, and an adoptive child line is dashed', () => {
  const layout = layoutHourglass(hourglass(P.marieAdopted, 2, 1));
  assert.ok(node(layout, P.karel).y < 0, 'birth father above');
  assert.equal(layout.otherParents.length, 1);
  assert.equal(layout.otherParents[0].linkType, 'adoptive');
  assert.deepEqual(layout.otherParents[0].parents.map((p) => p.id).sort(), [P.antonin, '0192f0c4-7a1e-7c3b-9d2a-000000000019'].sort());
  const fromAntonin = layoutHourglass(hourglass(P.antonin, 1, 1));
  const adoptive = fromAntonin.lines.find((l) => l.kind === 'child' && l.linkType === 'adoptive');
  assert.ok(adoptive, 'the adoptive child has a dashed line');
  assertNoOverlap(fromAntonin);
});

test('every depth from 1 to 6 lays out without overlaps', () => {
  for (const focus of Object.values(P))
    for (let up = 1; up <= 6; up++) for (let down = 1; down <= 6; down++) assertNoOverlap(layoutHourglass(hourglass(focus, up, down)));
});

test('life years: both, birth only, death only, none', () => {
  assert.equal(lifeYears({ birth: '1801-03-12', death: '1850-11-03' }), '1801–1850');
  assert.equal(lifeYears({ birth: '1745~', death: null }), '* 1745');
  assert.equal(lifeYears({ birth: null, death: '../1805' }), '† 1805');
  assert.equal(lifeYears({ birth: null, death: null }), '');
});
