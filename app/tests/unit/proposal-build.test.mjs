// Task 4.1: the Propose forms become the typed operations of one Proposal.
// tests/unit/proposal-contract.test.mjs checks the same operations against shared/.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOperations, draftTitle, emptyForm, formProblems } from '../../src/proposal-build.js';

/** @typedef {import('../../src/types.js').OperationInput} OperationInput */
/** @typedef {import('../../src/proposal-build.js').PersonInput} PersonInput */
/** @typedef {import('../../src/proposal-build.js').CitationForm} CitationForm */
/** @typedef {import('../../src/proposal-build.js').BaptismForm} BaptismForm */
/** @typedef {import('../../src/proposal-build.js').CorrectionTarget} CorrectionTarget */

/**
 * The one operation with this name; fails the test when there is none.
 * @template {OperationInput['op']} N
 * @param {OperationInput[]} ops
 * @param {N} name
 * @returns {Extract<OperationInput, { op: N }>}
 */
function only(ops, name) {
  /** @type {(o: OperationInput) => o is Extract<OperationInput, { op: N }>} */
  const named = (o) => o.op === name;
  const found = ops.filter(named);
  assert.equal(found.length, 1, `one ${name} operation`);
  return found[0];
}

/**
 * The operation at a position, which must have this name.
 * @template {OperationInput['op']} N
 * @param {OperationInput[]} ops
 * @param {number} i
 * @param {N} name
 * @returns {Extract<OperationInput, { op: N }>}
 */
function at(ops, i, name) {
  const found = ops.at(i);
  /** @type {(o: OperationInput | undefined) => o is Extract<OperationInput, { op: N }>} */
  const named = (o) => o?.op === name;
  assert.ok(named(found), `operation ${i} is ${name}`);
  return found;
}

/** @type {PersonInput} */
const father = { mode: 'existing', id: '0192f0c4-7a1e-7c3b-9d2a-000000000002', version: 3, label: 'Josef Dvořák' };
/** @type {PersonInput} */
const mother = { mode: 'existing', id: '0192f0c4-7a1e-7c3b-9d2a-000000000003', version: 2, label: 'Marie Dvořáková' };
/** @type {PersonInput & { mode: 'existing' }} */
const anna = { mode: 'existing', id: '0192f0c4-7a1e-7c3b-9d2a-000000000004', version: 1, label: 'Anna Králová' };
/** @type {CitationForm} */
const citation = {
  sourceMode: 'new',
  sourceType: 'parish_register',
  title: 'Invented register N 1790–1820',
  repository: 'Invented archive',
  page: '12',
  transcription: 'Wenceslaus filius legitimus…',
  confidence: 'high',
  readOn: '2026-10-01',
};

/** @type {BaptismForm} */
const baptism = {
  eventType: 'baptism',
  date: '1803-05-02',
  place: { id: '0192f0c4-7a1e-7c3b-9d2a-000000000005', label: 'Kamenná Lhota' },
  child: { mode: 'new', given: 'Václav', surname: 'Dvořák', sex: 'male' },
  father,
  mother,
  godparents: [anna, { mode: 'new', given: 'Tomáš', surname: 'Invented', sex: 'male' }],
  citation,
  note: '',
};

test("baptism entry: one Proposal adds the child and the baptism, links the parents' Family and the godparents, and cites the page with its image", () => {
  const family = { id: '0192f0c4-7a1e-7c3b-9d2a-000000000006', version: 4 };
  const ops = buildOperations({ kind: 'baptism', form: baptism }, { uploadIds: ['0192f0c4-7a1e-7c3b-9d2a-0000000000aa'], family });
  assert.deepEqual(
    ops.map((o) => o.op),
    [
      'createEvent',
      'createPerson',
      'addRole',
      'addRole',
      'addRole',
      'addRole',
      'createPerson',
      'addRole',
      'linkChild',
      'createSource',
      'createCitation',
      'addImage',
      'attachCitation',
    ],
  );
  const event = at(ops, 0, 'createEvent').tempId;
  const child = at(ops, 1, 'createPerson');
  assert.deepEqual(child.name, { given: 'Václav', surname: 'Dvořák', type: 'birth', asFound: 'Václav Dvořák' });
  assert.deepEqual(
    ops.filter((o) => o.op === 'addRole').map((o) => [o.role, o.personId]),
    [
      ['child', child.tempId],
      ['father', father.id],
      ['mother', mother.id],
      ['godparent', anna.id],
      ['godparent', at(ops, 6, 'createPerson').tempId],
    ],
  );
  assert.deepEqual(ops[8], { op: 'linkChild', familyId: family.id, childId: child.tempId, linkType: 'birth', baseVersion: 4 });
  const cited = at(ops, 10, 'createCitation');
  assert.equal(cited.page, '12');
  assert.deepEqual(ops[11], { op: 'addImage', uploadId: '0192f0c4-7a1e-7c3b-9d2a-0000000000aa', kind: 'page', citationId: cited.tempId });
  assert.deepEqual(ops[12], { op: 'attachCitation', citationId: cited.tempId, eventId: event });
});

test('without a Family of both parents, the Proposal creates one', () => {
  const ops = buildOperations({ kind: 'baptism', form: baptism }, { uploadIds: [], family: null });
  const family = only(ops, 'createFamily');
  assert.deepEqual([family.partner1Id, family.partner2Id], [father.id, mother.id]);
  assert.equal(only(ops, 'linkChild').familyId, family.tempId);
});

test('a Family account counts as evidence and has no page', () => {
  const account = {
    sourceMode: /** @type {const} */ ('account'),
    givenBy: 'Invented aunt',
    givenOn: '2026-05',
    transcription: 'Buried next to her husband.',
    confidence: /** @type {const} */ ('low'),
  };
  const ops = buildOperations(
    { kind: 'death', form: { eventType: 'burial', date: '1920', place: null, person: anna, citation: account, note: '' } },
    { uploadIds: [] },
  );
  assert.deepEqual(only(ops, 'createSource').familyAccount, { givenBy: 'Invented aunt', givenByPersonId: null, givenOn: '2026-05' });
  assert.equal(only(ops, 'createCitation').page, null);
  assert.deepEqual(
    formProblems({
      kind: 'death',
      form: {
        eventType: 'death',
        date: '',
        place: null,
        person: anna,
        citation: { sourceMode: 'account', givenBy: 'x', givenOn: '2026', transcription: 'y' },
        note: '',
      },
    }),
    [],
  );
});

test('a missing Citation is refused before submitting', () => {
  assert.deepEqual(formProblems({ kind: 'baptism', form: { ...baptism, citation: { sourceMode: 'new', title: '', transcription: '' } } }), [
    'propose.needEvidence',
  ]);
  assert.deepEqual(formProblems({ kind: 'baptism', form: { ...baptism, child: { mode: 'new', given: '', surname: '', sex: 'unknown' } } }), [
    'propose.needChild',
  ]);
  // An empty form of every kind names what is missing.
  for (const kind of /** @type {const} */ (['baptism', 'marriage', 'death', 'name', 'correction'])) assert.equal(formProblems(emptyForm(kind)).length, 2, kind);
});

test('a new Name and a correction cite the record they change', () => {
  const name = buildOperations(
    { kind: 'name', form: { person: anna, given: 'Anna', surname: 'Kralowa', type: 'german', asFound: 'Anna Kralowa', citation, note: '' } },
    { uploadIds: [] },
  );
  const added = at(name, 0, 'addName');
  assert.deepEqual(added, {
    op: 'addName',
    tempId: added.tempId,
    personId: anna.id,
    baseVersion: 1,
    given: 'Anna',
    surname: 'Kralowa',
    type: 'german',
    asFound: 'Anna Kralowa',
  });
  assert.deepEqual(name.at(-1), { op: 'attachCitation', citationId: at(name, -2, 'createCitation').tempId, nameId: added.tempId });
  /** @type {CorrectionTarget} */
  const target = { record: 'event', id: '0192f0c4-7a1e-7c3b-9d2a-000000000007', version: 5, label: 'death 1850', current: { date: '1850' } };
  const fix = buildOperations({ kind: 'correction', form: { person: anna, target, set: { date: '1850-11-03' }, citation, note: '' } }, { uploadIds: [] });
  assert.deepEqual(fix[0], { op: 'setField', record: 'event', id: target.id, baseVersion: 5, set: { date: '1850-11-03' } });
  assert.deepEqual(fix.at(-1), { op: 'attachCitation', citationId: at(fix, -2, 'createCitation').tempId, eventId: target.id, baseVersion: 5 });
});

test('Drafts have readable titles', () => {
  const t = (/** @type {string} */ k) => ({ 'propose.kind.marriage': 'Marriage', 'propose.unnamed': 'unnamed' })[k] ?? k;
  const empty = emptyForm('marriage');
  assert.ok(empty.kind === 'marriage');
  assert.equal(
    draftTitle({ kind: 'marriage', form: { ...empty.form, partner1: father, partner2: { mode: 'new', given: 'Eva', surname: 'Invented', sex: 'female' } } }, t),
    'Marriage: Josef Dvořák & Eva Invented',
  );
  assert.equal(draftTitle(empty, t), 'Marriage: unnamed');
});

test('a Citation read after midnight in Czechia is dated that day, not the UTC day before', (t) => {
  const zone = process.env.TZ;
  process.env.TZ = 'Europe/Prague';
  t.after(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-29T23:30:00Z') });
  const empty = emptyForm('death');
  assert.ok(empty.kind === 'death');
  assert.equal(empty.form.citation.readOn, '2026-10-30');
  const ops = buildOperations({ kind: 'death', form: { ...empty.form, person: anna, citation: { ...citation, readOn: '' } } }, { uploadIds: [] });
  assert.equal(only(ops, 'createCitation').readOn, '2026-10-30');
});

test('a photo cited from an existing Source is a page image when the Source is a register', () => {
  /** @param {import('../../src/types.js').SourceType} type */
  const kindFor = (type) => {
    const existing = {
      sourceMode: /** @type {const} */ ('existing'),
      source: { id: '0192f0c4-7a1e-7c3b-9d2a-000000000050', label: 'Invented register', type },
      transcription: 'Anna nata',
    };
    const ops = buildOperations(
      { kind: 'death', form: { eventType: 'death', date: '', place: null, person: anna, citation: existing, note: '' } },
      { uploadIds: ['0192f0c4-7a1e-7c3b-9d2a-0000000000aa'] },
    );
    return only(ops, 'addImage').kind;
  };
  assert.equal(kindFor('parish_register'), 'page');
  assert.equal(kindFor('census'), 'page');
  assert.equal(kindFor('other'), 'photo');
  assert.equal(kindFor('family_account'), 'photo');
});

test('a Name correction keeps the spelling as found: emptied, it is refused, never sent as null', () => {
  /** @type {CorrectionTarget} */
  const target = {
    record: 'name',
    id: '0192f0c4-7a1e-7c3b-9d2a-000000000008',
    version: 2,
    label: 'Name',
    current: { given: 'Anna', surname: 'Králová', asFound: 'Anna Králová' },
  };
  /** @param {Record<string, string>} set */
  const draft = (set) => ({ kind: /** @type {const} */ ('correction'), form: { person: anna, target, set, citation, note: '' } });
  assert.deepEqual(formProblems(draft({ asFound: ' ' })), ['propose.needAsFound']);
  assert.deepEqual(formProblems(draft({ surname: '' })), []);
  assert.deepEqual(only(buildOperations(draft({ surname: '', asFound: 'Anna' }), { uploadIds: [] }), 'setField').set, { surname: '', asFound: 'Anna' });
  // An Event's emptied date or description is cleared (null).
  /** @type {CorrectionTarget} */
  const event = { record: 'event', id: '0192f0c4-7a1e-7c3b-9d2a-000000000007', version: 5, label: 'death', current: { date: '1850', description: 'x' } };
  const cleared = buildOperations(
    { kind: 'correction', form: { person: anna, target: event, set: { description: ' ' }, citation, note: '' } },
    { uploadIds: [] },
  );
  assert.deepEqual(only(cleared, 'setField').set, { description: null });
});
