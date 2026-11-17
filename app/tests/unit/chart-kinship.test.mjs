// Kinship on Chart cards (add-kinship tasks 8.1 and 8.2; tree-charts spec, "Kinship on Chart
// cards"). The short forms the browser tests' mocked Chart route serves (tests/e2e/chart-kinship.json)
// are the server's own rules applied to the invented Novák family of the Chart tests
// (shared/test/chart-fixture.ts), for two readers: Lukáš, a great-grandson of Jan Novák, and his
// son Petr. The file is rewritten only with UPDATE_GOLDEN=1. Then: the term on one line of each
// card on screen, the layout otherwise unchanged, and no Sheet drawn from a model with kinship.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { NotASheet, sheet, sheetFile } from '../../src/chart-sheet.js';
import { chartLabels } from '../../src/chart-text.js';
import { layoutHouse } from '../../src/chart-house-layout.js';
import { layoutLine } from '../../src/chart-line-layout.js';
import { layoutTree } from '../../src/chart-tree-layout.js';
import { h as stringH } from '../../src/svg-string.js';
import { fontMetrics, goldenHouse, goldenTree, NOVAK as P, texts } from './chart-models.mjs';

// After chart-models.mjs, which loads shared-loader.mjs: these are TypeScript.
const { buildKinshipGraph } = await import('../../../shared/src/kinship-graph.js');
const { KinshipSearch, kinshipShortForm } = await import('../../../shared/src/kinship-paths.js');
const fixture = await import('../../../shared/test/chart-fixture.js');

/** @typedef {import('../../src/types.js').DescendantChart} DescendantChart */
/** @typedef {import('../../src/types.js').KinshipShort} KinshipShort */

const FILE = new URL('../e2e/chart-kinship.json', import.meta.url);
/** The readers: Lukáš (generation 4 of Jan Novák's Chart) and his son Petr. */
export const READERS = [P.lukas, P.petr];

/** The Family links of the Novák family as the server gathers them: a weak link has no confirming Citation. */
function data() {
  const rows = fixture.novakRows();
  const married = (/** @type {{ partner1Id: string | null, partner2Id: string | null }} */ f) =>
    rows.events.some(
      (e) =>
        e.type === 'marriage' &&
        e.roles.some((r) => r.role === 'partner' && r.personId === f.partner1Id) &&
        e.roles.some((r) => r.role === 'partner' && r.personId === f.partner2Id),
    );
  return {
    persons: rows.persons.map((p) => ({ id: p.id, sex: p.sex })),
    families: rows.families.map((f) => ({
      id: f.id,
      partner1: f.partner1Id,
      partner2: f.partner2Id,
      married: married(f),
      confidences: f.weakLink ? [] : ['normal'],
    })),
    childLinks: rows.childLinks.map((l) => {
      const confidences = l.weakLink ? [] : ['normal'];
      return { id: l.id, familyId: l.familyId, childId: l.childId, type: l.linkType, confidences1: confidences, confidences2: confidences };
    }),
  };
}

/** Each reader's short form of every Person of the Novák family, by id: what the server puts on the cards. */
function shortForms() {
  const g = buildKinshipGraph(data());
  /** @type {Record<string, Record<string, KinshipShort | null>>} */
  const out = {};
  for (const reader of READERS) {
    const s = new KinshipSearch(g, /** @type {number} */ (g.index.get(reader)));
    out[reader] = Object.fromEntries([...g.index].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, i]) => [id, kinshipShortForm(s, i)]));
  }
  return out;
}

test('the mocked short forms are the rules applied to the invented Novák family', () => {
  const text = `${JSON.stringify(shortForms(), null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN === '1') writeFileSync(FILE, text);
  assert.ok(existsSync(FILE), 'run with UPDATE_GOLDEN=1 to write tests/e2e/chart-kinship.json');
  assert.equal(readFileSync(FILE, 'utf8'), text);
});

const SHORT = shortForms();
const metrics = await fontMetrics();
const labels = { cs: chartLabels(await texts('cs'), 'cs'), en: chartLabels(await texts('en'), 'en') };

/**
 * A screen model with each card's kinship for a reader, as the server answers kinship=1.
 * @param {DescendantChart} model @param {string} reader @returns {DescendantChart}
 */
export function withKinship(model, reader) {
  return /** @type {DescendantChart} */ ({ ...model, persons: model.persons.map((p) => ({ ...p, kinship: SHORT[reader]?.[p.id] ?? null })) });
}

/** The text of a card's marks line, at its foot. @param {import('../../src/chart-tree-layout.js').LaidCard} c */
const footOf = (c) => c.lines.filter((l) => l.y === c.y + c.h - 14).map((l) => l.text);

test('"Switched on": each card shows its Person\'s kinship to the reader, on one line, in the reader\'s language', async () => {
  const screen = await goldenTree('novak-tree-4');
  const forLukas = layoutTree(withKinship(screen, P.lukas), metrics, labels.cs);
  const card = (/** @type {string} */ id) => forLukas.cards.find((c) => c.personId === id && c.kind === 'person');
  assert.deepEqual(footOf(/** @type {any} */ (card(P.jan))), ['praděd']);
  assert.deepEqual(footOf(/** @type {any} */ (card(P.antonin))), ['děd']);
  // Josef is a son of Jan's first marriage; the confirmed path to Lukáš goes through the second.
  assert.deepEqual(footOf(/** @type {any} */ (card(P.josef))), ['polorodý prastrýc']);
  assert.deepEqual(footOf(/** @type {any} */ (card(P.lukas))), ['vy']);
  // Karel is his grandfather only through Bohumil, whose link to Karel has no confirming Citation.
  assert.deepEqual(footOf(/** @type {any} */ (card(P.karel))), ['možná děd']);
  const en = layoutTree(withKinship(screen, P.lukas), metrics, labels.en);
  assert.deepEqual(footOf(/** @type {any} */ (en.cards.find((c) => c.personId === P.jan && c.kind === 'person'))), ['great-grandfather']);
  // Each Member sees their own kinship: for Petr, Lukáš is his father.
  const forPetr = layoutTree(withKinship(screen, P.petr), metrics, labels.cs);
  assert.deepEqual(footOf(/** @type {any} */ (forPetr.cards.find((c) => c.personId === P.lukas && c.kind === 'person'))), ['otec']);
});

test('the line form and the House chart: the term on the foot line of each card, after the life years on a sibling card', async () => {
  // The golden line form has no married sibling: give the first row one, a brother of the line.
  const golden = await goldenTree('novak-line');
  const rows = golden.rows.map((r, i) => (i === 0 ? { ...r, siblings: [{ personId: P.josef, side: /** @type {const} */ ('right'), families: [] }] } : r));
  const line = withKinship(/** @type {DescendantChart} */ ({ ...golden, rows }), P.lukas);
  const laid = layoutLine(line, metrics, labels.cs);
  const persons = new Map(line.persons.map((p) => [p.id, p]));
  const siblings = laid.cards.filter((c) => c.kind === 'sibling');
  assert.ok(siblings.length > 0, 'the line form has sibling cards');
  for (const c of siblings) {
    const p = persons.get(/** @type {string} */ (c.personId));
    const term = p ? labels.cs.kinship(p) : '';
    assert.ok(term, c.key);
    assert.ok(
      c.lines.some((l) => l.text.endsWith(` · ${term}`) || l.text.startsWith(`${term}`)),
      c.key,
    );
  }
  for (const c of laid.cards.filter((x) => x.kind === 'person' || x.kind === 'partner')) {
    const p = persons.get(/** @type {string} */ (c.personId));
    if (p && labels.cs.kinship(p)) assert.equal(footOf(c)[0]?.split(' · ')[0], labels.cs.kinship(p), c.key);
  }
  // The House chart's Persons are another invented family: any short form shows the same way.
  const house = await goldenHouse('house-a');
  const strýc = {
    kind: 'birth',
    term: { cs: { text: 'strýc', gender: 'm' }, en: { text: 'uncle', gender: 'm' } },
    possible: false,
    line: 'collateral',
    degree: 3,
    others: 0,
    more: false,
  };
  const withTerm = /** @type {typeof house} */ ({ ...house, persons: house.persons.map((p) => ({ ...p, kinship: strýc })) });
  const houseCards = layoutHouse(withTerm, metrics, labels.cs).cards.filter((c) => c.kind === 'person' || c.kind === 'partner');
  assert.ok(houseCards.length > 0);
  for (const c of houseCards) assert.equal(footOf(c)[0]?.split(' · ')[0], 'strýc', c.key);
});

test('with kinship the layout is the same but for the line at the foot of each card', async () => {
  const screen = await goldenTree('novak-tree-4');
  const plain = layoutTree(screen, metrics, labels.cs);
  const kin = layoutTree(withKinship(screen, P.lukas), metrics, labels.cs);
  const box = (/** @type {typeof plain} */ l) => l.cards.map((c) => [c.key, c.x, c.y, c.w, c.h]);
  assert.deepEqual(box(kin), box(plain));
  assert.deepEqual(kin.lines, plain.lines);
  assert.deepEqual([kin.width, kin.height], [plain.width, plain.height]);
  for (const [i, c] of kin.cards.entries()) {
    const other = /** @type {(typeof plain.cards)[number]} */ (plain.cards[i]);
    assert.deepEqual(
      c.lines.filter((l) => l.y !== c.y + c.h - 14),
      other.lines.filter((l) => l.y !== other.y + other.h - 14),
      c.key,
    );
    // The term fits the card: cut with "…" at the card's width, never past it.
    for (const l of c.lines) assert.ok(l.length === null || l.length <= c.w, c.key);
  }
});

test('"Printing": no Sheet, print or file is made from a model whose cards carry kinship', async () => {
  const reduced = await goldenTree('novak-tree-reduced');
  const kin = withKinship(reduced, P.lukas);
  const o = { model: kin, layout: layoutTree(kin, metrics, labels.cs), metrics, labels: labels.cs, title: 'Rozrod', fontCss: '' };
  assert.throws(() => sheetFile(o), NotASheet);
  assert.throws(() => sheet(/** @type {any} */ (stringH), { ...o, size: { w: 4200, h: 2970 } }), NotASheet);
  // Print refuses the screen variant too, as the files always did.
  const screen = await goldenTree('novak-tree-4');
  assert.throws(() => sheet(/** @type {any} */ (stringH), { ...o, model: screen, size: { w: 4200, h: 2970 } }), NotASheet);
  // The Sheet itself, without kinship, is drawn as before.
  assert.ok(sheetFile({ ...o, model: reduced, layout: layoutTree(reduced, metrics, labels.cs) }).startsWith('<?xml'));
});
