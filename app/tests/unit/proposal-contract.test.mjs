// The app builds Proposals the server accepts: every kind of Propose form, run
// through shared/'s checkOperations (the server's own check), and the app's
// copies of shared constants (operation set version, enum choices) match.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import './shared-loader.mjs';
import { buildOperations, CONFIDENCES, NAME_LANGUAGES, NAME_TYPES, NEW_SOURCE_TYPES, OPERATIONS_VERSION, SEXES } from '../../src/proposal-build.js';

// After shared-loader.mjs: these are TypeScript.
const { OPERATIONS_VERSION: SHARED_OPERATIONS_VERSION } = await import('../../../shared/src/schemas/proposals.js');
const { checkOperations } = await import('../../../shared/src/schemas/check-operations.js');
const { Confidence, NameType, Sex, SourceType } = await import('../../../shared/src/schemas/tree.js');
const { LANGUAGE_TAG_PATTERN } = await import('../../../shared/src/schemas/common.js');

/** @typedef {import('../../src/proposal-build.js').KindForm} KindForm */
/** @typedef {import('../../src/proposal-build.js').PersonInput} PersonInput */
/** @typedef {import('../../src/proposal-build.js').CitationForm} CitationForm */

const id = (/** @type {number} */ n) => `0192f0c4-7a1e-7c3b-9d2a-${String(n).padStart(12, '0')}`;
/** @type {PersonInput & { mode: 'existing' }} */
const anna = { mode: 'existing', id: id(4), version: 1, label: 'Anna Králová' };
/** @type {PersonInput} */
const newPerson = { mode: 'new', given: 'Tomáš', surname: 'Invented', sex: 'male' };
/** @type {Record<string, CitationForm>} */
const citations = {
  'a new register': {
    sourceMode: 'new',
    sourceType: 'parish_register',
    title: 'Invented register N 1790–1820',
    repository: 'Invented archive',
    reference: '',
    page: '12',
    transcription: 'Wenceslaus filius legitimus',
    confidence: 'high',
    readOn: '2026-10-01',
  },
  'an existing Source': {
    sourceMode: 'existing',
    source: { id: id(50), label: 'Invented register', type: 'parish_register' },
    page: '3',
    transcription: 'Anna nata',
    confidence: 'normal',
    readOn: '',
  },
  'a Family account': {
    sourceMode: 'account',
    givenBy: 'Invented aunt',
    givenOn: '2026-05',
    title: '',
    transcription: 'Buried next to her husband.',
    confidence: 'low',
  },
};

/** @param {CitationForm} citation @returns {[string, KindForm][]} */
const forms = (citation) => [
  [
    'baptism with new parents',
    {
      kind: 'baptism',
      form: {
        eventType: 'birth',
        date: '1803-05-02',
        place: { id: id(5), label: 'Kamenná Lhota' },
        child: { mode: 'new', given: 'Václav', surname: '', sex: 'male' },
        father: newPerson,
        mother: anna,
        godparents: [null, anna],
        citation,
        note: '',
      },
    },
  ],
  [
    'marriage',
    { kind: 'marriage', form: { date: '1858-11-23', place: null, partner1: anna, partner2: newPerson, witnesses: [newPerson], citation, note: 'n' } },
  ],
  ['burial', { kind: 'death', form: { eventType: 'burial', date: '', place: null, person: newPerson, citation, note: '' } }],
  ['new Name', { kind: 'name', form: { person: anna, given: '', surname: 'Kralowa', type: 'other', language: 'de', asFound: '', citation, note: '' } }],
  [
    'notes and Labels, with no Citation',
    {
      kind: 'notes',
      form: {
        person: anna,
        notes: 'Check the land book.',
        labels: ['line/kral', 'Emigrated'],
        base: { version: 3, notes: '', labels: ['emigrated', 'old'] },
        citation,
        note: '',
      },
    },
  ],
  [
    'new Name, language not known',
    { kind: 'name', form: { person: anna, given: 'Ana', surname: '', type: 'nickname', language: '', asFound: '', citation, note: '' } },
  ],
  [
    'new Name from a Draft written before the language tags',
    { kind: 'name', form: { person: anna, given: 'Anna', surname: '', type: 'latin', asFound: '', citation, note: '' } },
  ],
  [
    'Event correction that clears the description',
    {
      kind: 'correction',
      form: {
        person: anna,
        target: { record: 'event', id: id(7), version: 5, label: 'death', current: { date: '1850', description: 'x' } },
        set: { date: '1850-11-03', description: '' },
        citation,
        note: '',
      },
    },
  ],
  [
    'Name correction',
    {
      kind: 'correction',
      form: {
        person: anna,
        target: { record: 'name', id: id(8), version: 2, label: 'Name', current: { given: 'Anna', surname: 'Králová', asFound: 'Anna Králová' } },
        set: { given: '', asFound: 'Anna Kralowa' },
        citation,
        note: '',
      },
    },
  ],
];

test("every kind of Propose form, with every kind of Citation, passes the server's check of operations", () => {
  for (const [source, citation] of Object.entries(citations)) {
    for (const [name, draft] of forms(citation)) {
      for (const family of [null, { id: id(6), version: 4 }]) {
        const ops = buildOperations(draft, { uploadIds: [id(70)], family });
        const { issues } = checkOperations(ops, { editor: false });
        assert.deepEqual(issues, [], `${name}, from ${source}${family ? ', existing Family' : ''}`);
      }
    }
  }
});

test("the app's copies of shared constants match shared/", () => {
  assert.equal(OPERATIONS_VERSION, SHARED_OPERATIONS_VERSION);
  assert.deepEqual([...CONFIDENCES], Confidence.options);
  assert.deepEqual([...NAME_TYPES].sort(), [...NameType.options].sort());
  for (const tag of NAME_LANGUAGES) if (tag !== '') assert.match(tag, LANGUAGE_TAG_PATTERN);
  assert.deepEqual([...SEXES].sort(), [...Sex.options].sort());
  assert.deepEqual([...NEW_SOURCE_TYPES].sort(), SourceType.options.filter((s) => s !== 'family_account').sort());
});
