// Task 4.1: the Propose forms become the typed operations of one Proposal.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOperations, draftTitle, formProblems } from '../../src/proposal-build.js';

/**
 * The one operation of a kind; fails the test when there is none.
 * @param {Record<string, any>[]} ops
 * @param {string} name
 * @returns {Record<string, any>}
 */
function only(ops, name) {
  const found = ops.find((o) => o.op === name);
  assert.ok(found, `no ${name} operation`);
  return found;
}
/**
 * @param {Record<string, any>[]} ops
 * @param {number} i
 * @returns {Record<string, any>}
 */
function at(ops, i) {
  const found = ops.at(i);
  assert.ok(found, `no operation ${i}`);
  return found;
}

const father = { mode: 'existing', id: '0192f0c4-7a1e-7c3b-9d2a-000000000002', version: 3, label: 'Josef Dvořák' };
const mother = { mode: 'existing', id: '0192f0c4-7a1e-7c3b-9d2a-000000000003', version: 2, label: 'Marie Dvořáková' };
const anna = { mode: 'existing', id: '0192f0c4-7a1e-7c3b-9d2a-000000000004', version: 1, label: 'Anna Králová' };
const citation = { sourceMode: 'new', sourceType: 'parish_register', title: 'Invented register N 1790–1820', repository: 'Invented archive', page: '12', transcription: 'Wenceslaus filius legitimus…', confidence: 'high', readOn: '2026-10-01' };

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

test('baptism entry: one Proposal adds the child and the baptism, links the parents\' Family and the godparents, and cites the page with its image', () => {
  const family = { id: '0192f0c4-7a1e-7c3b-9d2a-000000000006', version: 4 };
  const ops = buildOperations('baptism', baptism, { uploadIds: ['0192f0c4-7a1e-7c3b-9d2a-0000000000aa'], family });
  assert.deepEqual(ops.map((o) => o.op), ['createEvent', 'createPerson', 'addRole', 'addRole', 'addRole', 'addRole', 'createPerson', 'addRole', 'linkChild', 'createSource', 'createCitation', 'addImage', 'attachCitation']);
  const event = ops[0].tempId;
  const child = ops[1].tempId;
  assert.deepEqual(ops[1].name, { given: 'Václav', surname: 'Dvořák', type: 'birth', asFound: 'Václav Dvořák' });
  assert.deepEqual(ops.filter((o) => o.op === 'addRole').map((o) => [o.role, o.personId]), [
    ['child', child],
    ['father', father.id],
    ['mother', mother.id],
    ['godparent', anna.id],
    ['godparent', ops[6].tempId],
  ]);
  assert.deepEqual(ops[8], { op: 'linkChild', familyId: family.id, childId: child, linkType: 'birth', baseVersion: 4 });
  assert.equal(ops[10].page, '12');
  assert.deepEqual(ops[11], { op: 'addImage', uploadId: '0192f0c4-7a1e-7c3b-9d2a-0000000000aa', kind: 'page', citationId: ops[10].tempId });
  assert.deepEqual(ops[12], { op: 'attachCitation', citationId: ops[10].tempId, eventId: event });
});

test('without a Family of both parents, the Proposal creates one', () => {
  const ops = buildOperations('baptism', baptism, { uploadIds: [], family: null });
  const family = only(ops, 'createFamily');
  assert.deepEqual([family.partner1Id, family.partner2Id], [father.id, mother.id]);
  assert.equal(only(ops, 'linkChild').familyId, family.tempId);
});

test('a Family account counts as evidence and has no page', () => {
  const ops = buildOperations('death', { eventType: 'burial', date: '1920', place: null, person: anna, citation: { sourceMode: 'account', givenBy: 'Invented aunt', givenOn: '2026-05', transcription: 'Buried next to her husband.', confidence: 'low' } }, { uploadIds: [] });
  assert.deepEqual(only(ops, 'createSource').familyAccount, { givenBy: 'Invented aunt', givenByPersonId: null, givenOn: '2026-05' });
  assert.equal(only(ops, 'createCitation').page, null);
  assert.deepEqual(formProblems('death', { person: anna, citation: { sourceMode: 'account', givenBy: 'x', givenOn: '2026', transcription: 'y' } }), []);
});

test('a missing Citation is refused before submitting', () => {
  assert.deepEqual(formProblems('baptism', { ...baptism, citation: { sourceMode: 'new', title: '', transcription: '' } }), ['propose.needEvidence']);
  assert.deepEqual(formProblems('baptism', { ...baptism, child: { mode: 'new', given: '', surname: '' } }), ['propose.needChild']);
});

test('a new Name and a correction cite the record they change', () => {
  const name = buildOperations('name', { person: anna, given: 'Anna', surname: 'Kralowa', type: 'german', asFound: 'Anna Kralowa', citation }, { uploadIds: [] });
  assert.deepEqual(name[0], { op: 'addName', tempId: name[0].tempId, personId: anna.id, baseVersion: 1, given: 'Anna', surname: 'Kralowa', type: 'german', asFound: 'Anna Kralowa' });
  assert.deepEqual(at(name, -1), { op: 'attachCitation', citationId: at(name, -2).tempId, nameId: name[0].tempId });
  const target = { record: 'event', id: '0192f0c4-7a1e-7c3b-9d2a-000000000007', version: 5, label: 'death 1850', current: { date: '1850' } };
  const fix = buildOperations('correction', { person: anna, target, set: { date: '1850-11-03' }, citation }, { uploadIds: [] });
  assert.deepEqual(fix[0], { op: 'setField', record: 'event', id: target.id, baseVersion: 5, set: { date: '1850-11-03' } });
  assert.deepEqual(at(fix, -1), { op: 'attachCitation', citationId: at(fix, -2).tempId, eventId: target.id, baseVersion: 5 });
});

test('Drafts have readable titles', () => {
  const t = (/** @type {string} */ k) => ({ 'propose.kind.marriage': 'Marriage', 'propose.unnamed': 'unnamed' })[k] ?? k;
  assert.equal(draftTitle('marriage', { partner1: father, partner2: { mode: 'new', given: 'Eva', surname: 'Invented' } }, t), 'Marriage: Josef Dvořák & Eva Invented');
  assert.equal(draftTitle('marriage', { partner1: null }, t), 'Marriage: unnamed');
});
