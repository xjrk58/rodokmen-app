import { describe, expect, it } from 'vitest';
import { exportLinks, exportRecord, hasLivingRole, reducePerson, type ExportCitation, type ExportEvent, type ExportRecord } from '../src/export.js';

/** Invented people only. */
const pageCitation: ExportCitation = {
  id: 'c1',
  sourceId: 's1',
  page: 'fol. 12',
  transcription: 'Invented entry: Anna Vzorová born.',
  confidence: 'high',
  note: '',
  links: [
    { kind: 'image', target: '/api/images/i1', label: 'page image' },
    { kind: 'web', target: 'https://archive.example/entry', label: 'archive' },
  ],
};

const birth: ExportEvent = {
  id: 'e1',
  type: 'birth',
  typeDetail: '',
  date: '2010-05-17',
  placeId: 'place-1',
  houseId: 'house-1',
  description: 'At home',
  notes: '',
  roles: [{ personId: 'p1', role: 'child', living: true }],
  citations: [pageCitation],
};

const livingGrandchild: ExportRecord = {
  kind: 'person',
  id: 'p1',
  living: true,
  concernsLiving: false,
  sex: 'female',
  names: [
    { given: 'Anna', surname: 'Vzorová', type: 'birth', language: 'cs', asFound: 'Anna Vzorová', citations: [pageCitation] },
    { given: 'Anička', surname: '', type: 'nickname', language: '', asFound: 'Anička', citations: [] },
  ],
  relations: [
    { rel: 'childOf', target: 'f1', detail: 'birth' },
    { rel: 'partnerIn', target: 'f2', detail: '' },
  ],
  birthYear: 2010,
  hasBirthYear: true,
  events: [birth],
  facts: [
    { key: 'relation', value: 'relative', detail: '' },
    { key: 'label', value: 'line/vzor', detail: '' },
  ],
  notes: 'Invented research note',
  links: [{ kind: 'image', target: '/api/images/portrait', label: 'portrait' }],
};

describe('the Export view of a record', () => {
  it('keeps only name, sex, relationships and birth year of a Living person (task 1.1)', () => {
    const view = exportRecord(livingGrandchild);
    expect(view).toEqual({
      kind: 'person',
      id: 'p1',
      living: true,
      concernsLiving: false,
      sex: 'female',
      names: [{ given: 'Anna', surname: 'Vzorová', type: '', language: '', asFound: '', citations: [] }],
      relations: livingGrandchild.relations,
      birthYear: 2010,
      hasBirthYear: true,
      events: [],
      facts: [],
      notes: '',
      links: [],
    });
    expect(reducePerson(livingGrandchild)).toEqual(view);
    expect(JSON.stringify(view)).not.toMatch(/2010-05-17|place-1|house-1|line\/vzor|research|Anička|fol\. 12|images/);
  });

  it('leaves out every Event with a Living person, and the notes of a record that concerns one', () => {
    const parent: ExportRecord = {
      ...livingGrandchild,
      id: 'p0',
      living: false,
      names: [],
      events: [{ ...birth, roles: [...birth.roles, { personId: 'p0', role: 'mother', living: false }] }],
    };
    expect(exportRecord(parent).events).toEqual([]);
    expect(hasLivingRole(parent.events[0]!)).toBe(true);
    const family: ExportRecord = { ...livingGrandchild, kind: 'family', id: 'f1', living: false, concernsLiving: true, names: [], events: [] };
    expect(exportRecord(family).notes).toBe('');
    expect(exportRecord({ ...family, concernsLiving: false }).notes).toBe('Invented research note');
  });

  it('keeps a Citation’s text and confidence without its page image (scenario "Citation with a page image", task 2.3)', () => {
    const dead: ExportRecord = {
      ...livingGrandchild,
      living: false,
      events: [{ ...birth, date: '1801-05-17', roles: [{ personId: 'p1', role: 'child', living: false }] }],
    };
    const view = exportRecord(dead);
    const c = view.events[0]!.citations[0]!;
    expect(c).toMatchObject({ transcription: pageCitation.transcription, confidence: 'high', page: 'fol. 12' });
    expect(c.links).toEqual([{ kind: 'web', target: 'https://archive.example/entry', label: 'archive' }]);
    expect(view.names[0]!.citations[0]!.links.map((l) => l.kind)).toEqual(['web']);
    expect(view.links).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('/api/images/');
  });

  it('keeps every link that is not to an image or a document, in order', () => {
    expect(
      exportLinks([
        { kind: 'web', target: 'a', label: '' },
        { kind: 'document', target: 'b', label: '' },
        { kind: 'record', target: 'c', label: '' },
        { kind: 'image', target: 'd', label: '' },
      ]).map((l) => l.target),
    ).toEqual(['a', 'c']);
  });
});
