// The Chart's words (src/chart-text.js), its cards' text fitting (src/chart-cards.js) and its
// addresses (src/routes.js): every date shape of the EDTF subset in Czech and English, counts,
// names, and one address per Chart.
import './shared-loader.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fit, measure, nameLines, SIZE } from '../../src/chart-cards.js';
import { chartLabels, dateParts, pluralOf } from '../../src/chart-text.js';
import { chartAddress, chartQuery, parseRoute } from '../../src/routes.js';
import { fontMetrics, texts } from './chart-models.mjs';

// After shared-loader.mjs: TypeScript.
const { parseEdtf } = await import('../../../shared/src/edtf.js');

const cs = chartLabels(await texts('cs'), 'cs');
const en = chartLabels(await texts('en'), 'en');
const metrics = await fontMetrics();

test("every date shape of the EDTF subset, written by each language's fixed pattern", () => {
  const cases = [
    ['1801-03-12', '12. března 1801', '12 Mar 1801'],
    ['1801-03', 'březen 1801', 'Mar 1801'],
    ['1801', '1801', '1801'],
    // Scenario "An approximate date".
    ['1801~', 'kolem 1801', 'about 1801'],
    ['1801?', '1801?', '1801?'],
    ['1801-03-12~', 'kolem 12. března 1801', 'about 12 Mar 1801'],
    ['1801/1803', '1801–1803', '1801–1803'],
    ['1801-02/1801-05', 'únor 1801–květen 1801', 'Feb 1801–May 1801'],
    ['../1805', 'před 1805', 'before 1805'],
    ['1790/..', 'po 1790', 'after 1790'],
  ];
  for (const [edtf, c, e] of cases) {
    assert.equal(cs.date(edtf), c, edtf);
    assert.equal(en.date(edtf), e, edtf);
  }
});

test('the app reads the same forms as the shared EDTF parser', () => {
  const forms = {
    day: '1801-03-12',
    month: '1801-03',
    year: '1801',
    about: '1801~',
    uncertain: '1801?',
    between: '1801/1803',
    before: '../1805',
    after: '1790/..',
  };
  for (const [form, edtf] of Object.entries(forms)) {
    assert.equal(parseEdtf(edtf).form, form);
    assert.equal(dateParts(edtf)?.form, form);
  }
});

test('"Counts": 5 descendants left out, and the plural forms of each language', () => {
  assert.equal(cs.count('chart.leftOut', 5), '5 potomků');
  assert.equal(en.count('chart.leftOut', 5), '5 descendants');
  assert.deepEqual(
    [1, 2, 4, 5, 21, 0].map((n) => cs.count('chart.leftOut', n)),
    ['1 potomek', '2 potomci', '4 potomci', '5 potomků', '21 potomků', '0 potomků'],
  );
  assert.deepEqual(
    [1, 2].map((n) => en.count('chart.leftOut', n)),
    ['1 descendant', '2 descendants'],
  );
  // CLDR's integer categories, fixed: one, few (2–4) in Czech and Slovak; one and other in English and German.
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 11].map((n) => pluralOf('sk', n)),
    ['other', 'one', 'few', 'few', 'few', 'other', 'other'],
  );
  assert.deepEqual(
    [0, 1, 2].map((n) => pluralOf('de', n)),
    ['other', 'one', 'other'],
  );
});

test('"Married name": the birth surname after the married one, in each language', () => {
  const p = /** @type {import('../../src/types.js').ChartPerson} */ ({ given: 'Marie', surname: 'Nováková', birthSurname: 'Dvořáková', nameless: false });
  assert.equal(cs.name(p), 'Marie Nováková roz. Dvořáková');
  assert.equal(en.name(p), 'Marie Nováková née Dvořáková');
  assert.equal(cs.name({ ...p, nameless: true }), 'žijící osoba');
});

test('a House and its numbers', () => {
  const fact = { eventId: 'e', type: /** @type {const} */ ('death'), date: '1850', placeId: 'p', place: 'Kamenná Lhota', houseId: 'h', houseNumber: '15' };
  assert.equal(cs.fact(fact), '1850 Kamenná Lhota čp. 15');
  assert.equal(en.fact(fact), '1850 Kamenná Lhota No. 15');
});

test("text is fitted by the fonts' widths: a long Czech name in two lines, a very long one cut, the same every run", () => {
  const width = 420 - 32;
  const name = 'Terezie Apolena Nováková roz. Dvořáková';
  assert.ok(measure(metrics, 'semibold', SIZE.name, name) > width);
  const lines = nameLines(metrics, name, width);
  assert.equal(lines.length, 2);
  assert.equal(lines.map((l) => l.text).join(' '), name);
  const long = 'Bartoloměj Maxmilián Svatopluk Kryštof Bohuslav Šťastný-Nepomucký z Kamenné Lhoty';
  const cut = fit(metrics, 'semibold', SIZE.name, long, width);
  assert.ok(cut.text.endsWith('…'));
  assert.ok(measure(metrics, 'semibold', SIZE.name, cut.text) * 0.85 <= width);
  // Slightly too long: set narrower, whole.
  const squeezed = fit(metrics, 'semibold', SIZE.name, name, measure(metrics, 'semibold', SIZE.name, name) * 0.9);
  assert.equal(squeezed.text, name);
  assert.ok(squeezed.length !== null);
  assert.deepEqual(nameLines(metrics, name, width), lines);
});

test("a Chart's address: parsed and written back the same, defaults left out, keys sorted", () => {
  const id = '0192f0c4-7a1e-7c3b-9d2a-000000000001';
  const line = '0192f0c4-7a1e-7c3b-9d2a-000000000014';
  assert.equal(chartAddress({ kind: 'descendants', start: 'person', id }), `#chart/descendants/person/${id}`);
  const full = `#chart/descendants/family/${id}?generations=6&line=${line}&living=nameless&paper=a4-portrait&title=Rod%20Nov%C3%A1kov%C3%BDch`;
  const route = parseRoute(full);
  assert.equal(route.screen, 'chart');
  if (route.screen !== 'chart') return;
  assert.deepEqual(route.chart, {
    kind: 'descendants',
    start: 'family',
    id,
    generations: 6,
    form: 'tree',
    line,
    from: null,
    to: null,
    unrelated: false,
    title: 'Rod Novákových',
    paper: 'a4-portrait',
    living: 'nameless',
  });
  assert.equal(chartAddress(route.chart), full);
  // One address per Chart: the same options in another order, or a default written out, give it again.
  const other = parseRoute(
    `#chart/descendants/family/${id}?title=Rod%20Nov%C3%A1kov%C3%BDch&paper=a4-portrait&living=nameless&line=${line}&generations=6&form=tree`,
  );
  if (other.screen === 'chart') assert.equal(chartAddress(other.chart), full);
  const house = parseRoute(`#chart/house/${id}?unrelated=1&from=1790&to=1850`);
  assert.equal(house.screen, 'chart');
  if (house.screen === 'chart') {
    assert.equal(chartAddress(house.chart), `#chart/house/${id}?from=1790&to=1850&unrelated=1`);
    assert.equal(chartQuery(house.chart, null), `charts/house/${id}?from=1790&to=1850&unrelated=true`);
    assert.equal(chartQuery(house.chart, 'reduced'), `charts/house/${id}?from=1790&to=1850&unrelated=true&sheet=reduced`);
  }
  // A bad address opens nothing.
  assert.equal(parseRoute('#chart/descendants/person/nope').screen, 'home');
});

test('"Kinship on Chart cards": kinship=1 only for the screen variant, never with sheet, and never in the address', () => {
  const id = '0192f0c4-7a1e-7c3b-9d2a-000000000001';
  const route = parseRoute(`#chart/descendants/person/${id}?generations=6&kinship=1`);
  assert.equal(route.screen, 'chart');
  if (route.screen !== 'chart') return;
  // The address has no place for kinship: the switch is the device's.
  assert.equal(chartAddress(route.chart), `#chart/descendants/person/${id}?generations=6`);
  assert.equal(chartQuery(route.chart, 'kinship'), `charts/descendants?person=${id}&generations=6&kinship=1`);
  for (const sheet of /** @type {const} */ (['reduced', 'nameless'])) {
    assert.equal(chartQuery(route.chart, sheet), `charts/descendants?person=${id}&generations=6&sheet=${sheet}`);
    assert.doesNotMatch(chartQuery({ ...route.chart, living: sheet }, sheet), /kinship/);
  }
  const house = parseRoute(`#chart/house/${id}`);
  if (house.screen === 'chart') assert.equal(chartQuery(house.chart, 'kinship'), `charts/house/${id}?kinship=1`);
});
