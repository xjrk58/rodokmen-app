import { describe, expect, it } from 'vitest';
import { checkOperations, describeOperations, EVIDENCE_MESSAGE, OPERATION_NAMES, Operation, type OperationInput, type SummaryContext } from '../src/index.js';

// Invented records: ids and the labels a server would look up for them.
const ids = {
  anna: '0192f0c4-7a1e-7c3b-9d2a-000000000001',
  father: '0192f0c4-7a1e-7c3b-9d2a-000000000002',
  mother: '0192f0c4-7a1e-7c3b-9d2a-000000000003',
  family: '0192f0c4-7a1e-7c3b-9d2a-000000000004',
  place: '0192f0c4-7a1e-7c3b-9d2a-000000000005',
  source: '0192f0c4-7a1e-7c3b-9d2a-000000000006',
  citation: '0192f0c4-7a1e-7c3b-9d2a-000000000007',
  event: '0192f0c4-7a1e-7c3b-9d2a-000000000008',
  name: '0192f0c4-7a1e-7c3b-9d2a-000000000009',
  upload: '0192f0c4-7a1e-7c3b-9d2a-00000000000a',
  dup: '0192f0c4-7a1e-7c3b-9d2a-00000000000b',
};
const labels: Record<string, { cs: string; en: string }> = {
  [ids.anna]: { cs: 'Anna Králová', en: 'Anna Králová' },
  [ids.father]: { cs: 'Josef Dvořák', en: 'Josef Dvořák' },
  [ids.mother]: { cs: 'Marie Dvořáková', en: 'Marie Dvořáková' },
  [ids.family]: { cs: 'rodina Josef Dvořák a Marie Dvořáková', en: 'the Family of Josef Dvořák and Marie Dvořáková' },
  [ids.place]: { cs: 'Kamenná Lhota', en: 'Kamenná Lhota' },
  [ids.source]: { cs: '„Matrika N 1790–1820“', en: '“Register N 1790–1820”' },
  [ids.citation]: { cs: 'Matrika N, s. 12', en: 'Register N, p. 12' },
  [ids.event]: { cs: 'úmrtí 1850', en: 'the death of 1850' },
  [ids.name]: { cs: '„Joannes Nowak“', en: '“Joannes Nowak”' },
  [ids.dup]: { cs: 'Jan Novák (2)', en: 'Jan Novák (2)' },
};
const ctx: SummaryContext = { label: (ref, lang) => labels[ref]?.[lang] ?? ref };

/** One example of every operation, as a baptism entry plus the rest. */
const examples: OperationInput[] = [
  { op: 'createPerson', tempId: 'tmp:child', sex: 'male', name: { given: 'Václav', surname: 'Dvořák', type: 'birth', asFound: 'Wenceslaus Dworžak' } },
  { op: 'createEvent', tempId: 'tmp:baptism', type: 'baptism', date: '1803-05-02', placeId: ids.place },
  { op: 'addRole', eventId: 'tmp:baptism', personId: 'tmp:child', role: 'child' },
  { op: 'addRole', eventId: 'tmp:baptism', personId: ids.anna, role: 'godparent' },
  { op: 'linkChild', familyId: ids.family, childId: 'tmp:child', linkType: 'birth', baseVersion: 3 },
  { op: 'createFamily', tempId: 'tmp:fam', partner1Id: ids.father, partner2Id: ids.mother },
  { op: 'addName', tempId: 'tmp:latin', personId: 'tmp:child', given: 'Wenceslaus', surname: 'Dworžak', type: 'latin', asFound: 'Wenceslaus Dworžak' },
  { op: 'createSource', tempId: 'tmp:register', type: 'parish_register', title: 'Matrika N 1790–1820', repository: 'Státní oblastní archiv (invented)' },
  {
    op: 'createSource',
    tempId: 'tmp:account',
    type: 'family_account',
    title: 'Grandmother remembers',
    familyAccount: { givenBy: 'Eva Dvořáková', givenByPersonId: null, givenOn: '2026-05' },
  },
  {
    op: 'createCitation',
    tempId: 'tmp:cit',
    sourceId: 'tmp:register',
    page: '12',
    transcription: 'Wenceslaus filius legitimus…',
    readOn: '2026-10-01',
    confidence: 'high',
  },
  { op: 'attachCitation', citationId: 'tmp:cit', eventId: 'tmp:baptism' },
  { op: 'attachCitation', citationId: ids.citation, nameId: ids.name, baseVersion: 1 },
  { op: 'addImage', uploadId: ids.upload, kind: 'page', citationId: 'tmp:cit' },
  { op: 'setField', record: 'event', id: ids.event, baseVersion: 2, set: { date: '1850-11-03', placeId: ids.place } },
  { op: 'mergePersons', keepId: ids.anna, mergeId: ids.dup, keepBaseVersion: 1, mergeBaseVersion: 1 },
  { op: 'restoreRecord', table: 'person', id: ids.dup, baseVersion: 2, values: { id: ids.dup, sex: 'male', merged_into_id: null } },
];

describe('links in Sources', () => {
  const source = (url: string) => ({ op: 'createSource', tempId: 'tmp:src', type: 'other', title: 'Online index', url });
  it('accepts http and https links', () => {
    for (const url of ['https://www.portafontium.eu/register/soap-ck/00001', 'http://example.org/scan?id=12'])
      expect(Operation.safeParse(source(url)).success, url).toBe(true);
  });
  it('refuses links that would run script or carry their own page', () => {
    for (const url of [
      'javascript:alert(document.cookie)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(Operation.safeParse(source(url)).success, url).toBe(false);
    }
    const set = { op: 'setField', record: 'source', id: ids.source, baseVersion: 1, set: { url: 'javascript:alert(1)' } };
    expect(Operation.safeParse(set).success).toBe(false);
  });
});

describe('typed operations', () => {
  it('the examples cover the whole closed set', () => {
    expect(new Set(examples.map((e) => e.op))).toEqual(new Set(OPERATION_NAMES));
  });

  it('readable summaries of every operation in Czech and English (snapshot)', async () => {
    const ops = examples.map((e) => Operation.parse(e));
    const lines = describeOperations(ops, ctx).map((s, i) => `${ops[i]!.op}\n  cs: ${s.cs}\n  en: ${s.en}`);
    await expect(lines.join('\n') + '\n').toMatchFileSnapshot('__snapshots__/operation-summaries.txt');
  });

  it('a whole baptism entry passes the checks', () => {
    const { issues, operations } = checkOperations(examples.slice(0, 13), { editor: false });
    expect(issues).toEqual([]);
    expect(operations).toHaveLength(13);
  });

  it('refuses a Proposal without any Citation', () => {
    const { issues } = checkOperations(examples.slice(0, 4), { editor: false });
    expect(issues).toEqual([{ code: 'evidence_missing', message: EVIDENCE_MESSAGE.en }]);
  });

  it('a Citation of a Family account counts as evidence', () => {
    const ops: OperationInput[] = [
      examples[8]!,
      {
        op: 'createCitation',
        tempId: 'tmp:c',
        sourceId: 'tmp:account',
        transcription: 'They married in the spring, she said.',
        readOn: '2026-05-10',
        confidence: 'low',
      },
      { op: 'attachCitation', citationId: 'tmp:c', eventId: ids.event, baseVersion: 2 },
    ];
    expect(checkOperations(ops, { editor: false }).issues).toEqual([]);
  });

  it('rejects unknown operations instead of guessing', () => {
    const { issues } = checkOperations([{ op: 'deleteEverything' }, examples[9]], { editor: true });
    expect(issues.map((i) => i.code)).toContain('unknown_operation');
  });

  it('temporary ids must be created before use, once, with the right kind', () => {
    const used = checkOperations([{ op: 'addRole', eventId: 'tmp:later', personId: ids.anna, role: 'witness' }, examples[9]], { editor: false });
    expect(used.issues.map((i) => i.code)).toContain('temp_id');
    const wrongKind = checkOperations([examples[0], { op: 'addRole', eventId: 'tmp:child', personId: ids.anna, role: 'witness' }], { editor: false });
    expect(wrongKind.issues[0]!.message).toMatch(/tmp:child is a person, not a event/);
  });

  it('changes to existing records name the version the Member saw', () => {
    const { issues } = checkOperations([{ op: 'setField', record: 'name', id: ids.name, set: { surname: 'Novák' } }], { editor: false });
    expect(issues[0]!.code).toBe('invalid_operation');
    const unknownField = checkOperations([{ op: 'setField', record: 'name', id: ids.name, baseVersion: 1, set: { colour: 'red' } }], { editor: false });
    expect(unknownField.issues[0]!.message).toMatch(/no settable field "colour"/);
  });

  it('refuses field names inherited from Object.prototype instead of crashing', () => {
    for (const key of ['constructor', 'toString', 'hasOwnProperty']) {
      const { issues } = checkOperations([{ op: 'setField', record: 'name', id: ids.name, baseVersion: 1, set: { [key]: 'x' } }], { editor: true });
      expect(issues[0]!.message).toContain(`no settable field "${key}"`);
    }
    // As JSON.parse leaves it: an own property named __proto__.
    const raw: unknown = JSON.parse(`{"op":"setField","record":"name","id":"${ids.name}","baseVersion":1,"set":{"__proto__":{"polluted":true}}}`);
    const { issues } = checkOperations([raw], { editor: true });
    expect(issues.length).toBeGreaterThan(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('only Editors merge, and nobody submits restoreRecord', () => {
    expect(checkOperations([examples[14]], { editor: false }).issues[0]!.code).toBe('not_allowed');
    expect(checkOperations([examples[14]], { editor: true }).issues).toEqual([]);
    expect(checkOperations([examples[15]], { editor: true }).issues[0]!.code).toBe('not_allowed');
    expect(checkOperations([examples[15]], { editor: true, allowRestore: true }).issues).toEqual([]);
  });
});
