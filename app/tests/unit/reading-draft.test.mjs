// A reading becomes a Draft the Member checks, and then a Proposal the server accepts
// (scan-reading spec): the operations run through shared/'s checkOperations, the "read by AI"
// marks follow the proved rule (stillReadByAi in shared/src/reading.ts), and nobody is created
// or matched without the Member's choice.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import './shared-loader.mjs';
import { readJson } from './helpers.mjs';
import { buildReading, fillFromReading, newReadingForm, READING_CONFIDENCES, readingProblems, readingTitle, stillReadByAi } from '../../src/reading-draft.js';
import { isLink } from '../../src/reading-start.js';

// After shared-loader.mjs: these are TypeScript.
const { checkOperations } = await import('../../../shared/src/schemas/proposals.js');
const shared = await import('../../../shared/src/reading.js');
const { ReaderInfo, ReadingResult, isPortalLink } = await import('../../../shared/src/schemas/reading.js');
const { Confidence } = await import('../../../shared/src/schemas/tree.js');

/** @typedef {import('../../src/reading-draft.js').ReadingForm} ReadingForm */
/** @typedef {import('../../src/types.js').ReadingView} ReadingView */

const ID = (/** @type {number} */ n) => `0192f0c4-7a1e-7c3b-9d2a-${String(n).padStart(12, '0')}`;
const JAN = ID(7);

/**
 * The text of a recorded answer of the Messages API.
 * @param {unknown} message
 * @returns {string}
 */
function textOf(message) {
  if (typeof message !== 'object' || message === null || !('content' in message) || !Array.isArray(message.content)) throw new Error('not a message');
  /** @type {unknown} */
  const block = message.content[0];
  if (typeof block !== 'object' || block === null || !('text' in block) || typeof block.text !== 'string') throw new Error('no text');
  return block.text;
}

/** The recorded reading of the invented baptism page (server/test/fixtures/readings). */
/** @type {unknown} */
const recorded = await readJson('../server/test/fixtures/readings/baptism-page.json');
const result = ReadingResult.parse(JSON.parse(textOf(recorded)));

/** @returns {ReadingView} */
function view() {
  const person = {
    id: JAN,
    version: 3,
    sex: 'male',
    given: 'Jan',
    surname: 'Novák',
    displayName: 'Jan Novák',
    living: false,
    birth: '1801-03-12',
    death: null,
    relation: 'relative',
    familyRoot: false,
  };
  return /** @type {ReadingView} */ ({
    id: ID(1),
    status: 'done',
    author: { id: ID(2), displayName: 'Karel Contributor', isAgent: false },
    uploadIds: [ID(900)],
    crops: [],
    context: { sourceId: null, sourceTitle: 'Invented register N 1820–1840', page: '41', placeId: ID(500), years: null, note: null, link: null },
    model: 'claude-opus-5-5',
    createdAt: '2026-11-02T09:00:00.000Z',
    finishedAt: '2026-11-02T09:01:00.000Z',
    result,
    error: null,
    matches: [{ key: 'p2', candidates: [{ person, score: 30, reasons: { name: true, house: true, years: true, place: true, family: true } }] }],
    houses: [ID(600), null, null],
    leads: [],
  });
}

/** @returns {ReadingForm} */
function form() {
  const citation = {
    sourceMode: /** @type {const} */ ('new'),
    title: 'Invented register N 1820–1840',
    page: '41',
    confidence: /** @type {const} */ ('normal'),
    readOn: '2026-11-02',
    transcription: '',
  };
  return fillFromReading(
    view(),
    newReadingForm(ID(1), { place: { id: ID(500), label: 'Kamenná Lhota' }, citation, link: null, note: 'Three baptisms of 1830' }),
  );
}

/** Every person new, except the father of the first entry, linked to Jan Novák with one tap. */
function chooseAll(/** @type {ReadingForm} */ f) {
  for (const e of f.entries) for (const p of e.persons) p.choice = { mode: 'new' };
  const father = f.entries[0]?.persons.find((p) => p.key === 'p2');
  const jan = father?.candidates[0];
  assert.ok(father && jan, 'Jan Novák is suggested for the father');
  father.choice = { mode: 'existing', id: jan.id, version: jan.version, label: jan.label };
  return f;
}

const ctx = { uploadIds: [ID(900)], readOn: '2026-11-02' };

test('the mark rule is the proved one: marked while from the reader, unconfirmed and unchanged', () => {
  for (const fromReader of [false, true])
    for (const confirmed of [false, true])
      for (const changed of [false, true]) {
        assert.equal(
          stillReadByAi(fromReader, confirmed, changed),
          shared.stillReadByAi(fromReader, confirmed, changed),
          `${fromReader} ${confirmed} ${changed}`,
        );
      }
});

test('a reading Citation offers at most normal confidence, which the server keeps', () => {
  for (const c of READING_CONFIDENCES) {
    assert.ok(Confidence.safeParse(c).success);
    assert.equal(shared.capConfidence(c, true), c);
  }
  assert.deepEqual(READING_CONFIDENCES, ['very_low', 'low', 'normal']);
});

test('a page with three baptism entries becomes a Draft with three entries, each with its Roles, date, house and transcription (scenario "Baptism page")', () => {
  const f = form();
  assert.equal(f.state, 'done');
  assert.equal(f.entries.length, 3);
  for (const e of f.entries)
    assert.deepEqual(
      e.persons.map((p) => p.role),
      ['child', 'father', 'mother', 'godparent', 'priest'],
    );
  assert.deepEqual(
    f.entries.map((e) => [e.date.value, e.house.value]),
    [
      ['1830-03-14', '15'],
      ['1830-05-02', '23'],
      ['1830-06-20', ''],
    ],
  );
  assert.match(f.entries[2]?.illegible[0]?.note ?? '', /faded/);
  assert.equal(
    readingTitle(f, (key, params) => `${key} ${JSON.stringify(params ?? {})}`),
    'reading.title {"count":3,"names":"Anna, Josephus, Thomas"}',
  );
});

test('nobody is created or linked without the Member’s choice (scenario "Known father")', () => {
  const f = form();
  assert.deepEqual(readingProblems(f), ['reading.needChoice']);
  chooseAll(f);
  assert.deepEqual(readingProblems(f), []);
  const { operations } = buildReading(f, ctx);
  assert.equal(operations.filter((o) => o.op === 'createPerson').length, 14);
  assert.ok(operations.some((o) => o.op === 'addRole' && o.personId === JAN && o.role === 'father'));
});

test('builds a Proposal the server accepts: one Citation for the page with its image, attached to every entry', () => {
  const { operations, marks } = buildReading(chooseAll(form()), ctx);
  const check = checkOperations(operations, { editor: false });
  assert.deepEqual(check.issues, []);
  assert.equal(operations.filter((o) => o.op === 'createCitation').length, 1);
  assert.equal(operations.filter((o) => o.op === 'attachCitation').length, 3);
  assert.deepEqual(
    operations.find((o) => o.op === 'addImage'),
    { op: 'addImage', uploadId: ID(900), kind: 'page', citationId: 'tmp:citation1' },
  );
  // The first entry's House is in the Tree: linked, not described.
  const events = operations.filter((o) => o.op === 'createEvent');
  assert.deepEqual(
    events.map((e) => [e.houseId ?? null, e.placeId ?? null, e.description ?? null]),
    [
      [ID(600), null, null],
      [null, ID(500), 'čp. 23'],
      [null, ID(500), null],
    ],
  );
  assert.ok(ReaderInfo.safeParse({ readingIds: [ID(1)], marks }).success);
});

test('a corrected surname and a confirmed entry are no longer marked "read by AI", and the transcription keeps what the page shows (scenario "Member confirms")', () => {
  const f = chooseAll(form());
  const second = f.entries[1];
  const father = second?.persons.find((p) => p.key === 'p7');
  assert.ok(second && father);
  father.surname.value = 'Dvořák';
  const before = buildReading(f, ctx);
  const position = before.operations.findIndex((o) => o.op === 'createPerson' && o.tempId === 'tmp:p7');
  // Changed: the surname is the Member's now; the given name is still as read.
  assert.deepEqual(before.marks.find((m) => m.position === position)?.fields, ['name.given', 'sex', 'name.asFound']);
  assert.equal(/** @type {{ name: { surname: string, asFound: string } }} */ (before.operations[position]).name.surname, 'Dvořák');
  // The spelling as found stays as the page has it.
  assert.equal(/** @type {{ name: { asFound: string } }} */ (before.operations[position]).name.asFound, 'Wenceslai Dworzak');

  second.confirmed = true;
  const after = buildReading(f, ctx);
  const ops = after.operations;
  const marked = new Set(after.marks.map((m) => m.position));
  const ofEntry2 = ops.flatMap((o, i) =>
    ('eventId' in o && o.eventId === 'tmp:e2') || ('tempId' in o && ['tmp:e2', 'tmp:p6', 'tmp:p7', 'tmp:p8', 'tmp:p9', 'tmp:p10'].includes(o.tempId ?? ''))
      ? [i]
      : [],
  );
  assert.ok(ofEntry2.length > 5);
  for (const i of ofEntry2) assert.equal(marked.has(i), false, `operation ${i + 1} of the confirmed entry`);
  // The other entries are still unconfirmed: their values stay marked, and so does the page's transcription.
  assert.ok(ops.some((o, i) => o.op === 'createEvent' && o.tempId === 'tmp:e1' && marked.has(i)));
  const citation = ops.findIndex((o) => o.op === 'createCitation');
  assert.ok(marked.has(citation));
  assert.equal(/** @type {{ transcription: string }} */ (ops[citation]).transcription, result.pages[0]?.transcription);
});

test('a left-out entry is not proposed, and its page Citation goes with the entries left', () => {
  const f = chooseAll(form());
  const third = f.entries[2];
  assert.ok(third);
  third.skip = true;
  const { operations } = buildReading(f, ctx);
  assert.equal(operations.filter((o) => o.op === 'createEvent').length, 2);
  assert.deepEqual(checkOperations(operations, { editor: false }).issues, []);
  for (const e of f.entries) e.skip = true;
  assert.deepEqual(readingProblems(f), ['reading.needEntry']);
});

test('a pasted archive viewer address is recognised as a link, as the server does', () => {
  for (const text of ['https://portal.example-archive.test/view?frame=41', 'www.example-archive.test/scan/12', ID(1), 'Matrika N 1801']) {
    assert.equal(isLink(text), isPortalLink(text), text);
  }
});
