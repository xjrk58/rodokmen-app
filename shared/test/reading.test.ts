import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  birthWindow,
  capConfidence,
  checkOperations,
  CreateReadingBody,
  imagesToSend,
  isPortalLink,
  isSuggested,
  leadSuggestions,
  mayRead,
  nameTypeForLanguage,
  nameVariants,
  PORTAL_LINK_MESSAGE,
  ranksAbove,
  ReaderInfo,
  ReadingResult,
  readingOperations,
  scoreCandidate,
  stillReadByAi,
  unchosenPersons,
  type CandidateFacts,
  type ReadFacts,
} from '../src/index.js';

const ID = (n: number) => `0192f0c4-7a1e-7c3b-9d2a-${String(n).padStart(12, '0')}`;

/** An invented page of 1801 with one baptism: child, both parents, a godparent from čp. 7 and the priest. */
function baptismPage(): ReadingResult {
  return {
    pages: [{ page: 0, transcription: 'Anno 1801 die 12 Martii baptizatus est Wenceslaus …', languages: ['la'] }],
    entries: [
      {
        page: 0,
        type: 'baptism',
        typeDetail: null,
        date: '1801-03-12',
        dateAsWritten: '12. Martii',
        house: '12',
        place: 'Kamenna Lhota',
        transcription: 'Wenceslaus, filius legitimus Joannis Nowak coloni N. 12 et Catharinae …',
        persons: [
          {
            key: 'p1',
            role: 'child',
            roleDetail: null,
            sex: 'male',
            names: [{ given: 'Wenceslaus', surname: 'Nowak', asWritten: 'Wenceslaus', language: 'la' }],
            description: 'filius legitimus',
            house: null,
            residence: null,
          },
          {
            key: 'p2',
            role: 'father',
            roleDetail: null,
            sex: 'male',
            names: [{ given: 'Joannes', surname: 'Nowak', asWritten: 'Joannes Nowak', language: 'la' }],
            description: 'colonus',
            house: '12',
            residence: null,
          },
          {
            key: 'p3',
            role: 'mother',
            roleDetail: null,
            sex: 'female',
            names: [{ given: 'Catharina', surname: 'Swoboda', asWritten: 'Catharina nata Swoboda', language: 'la' }],
            description: null,
            house: null,
            residence: null,
          },
          {
            key: 'p4',
            role: 'godparent',
            roleDetail: null,
            sex: 'male',
            names: [{ given: 'Mathias', surname: 'Horak', asWritten: 'Mathias Horak', language: 'la' }],
            description: 'inquilinus',
            house: '7',
            residence: null,
          },
          {
            key: 'p5',
            role: 'priest',
            roleDetail: null,
            sex: 'male',
            names: [{ given: 'Franciscus', surname: 'Kral', asWritten: 'Franciscus Kral, cooperator', language: 'la' }],
            description: 'cooperator',
            house: null,
            residence: null,
          },
        ],
        illegible: [],
        hints: [{ kind: 'godparent_house', personKeys: ['p4'], house: '7', year: null, note: 'inquilinus N. 7' }],
      },
    ],
    note: null,
  };
}

const issuesOf = (value: unknown) => {
  const r = ReadingResult.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('the reading result schema (task 1.1)', () => {
  it('accepts a page with entries, Persons, Names with their language, Roles, EDTF dates, Houses, illegible markers and lead hints', () => {
    expect(issuesOf(baptismPage())).toEqual([]);
    const faded = baptismPage();
    faded.entries[0]!.house = null;
    faded.entries[0]!.illegible = [{ field: 'house', note: 'the number is faded' }];
    faded.entries[0]!.date = '1801-03?';
    expect(issuesOf(faded)).toEqual([]);
  });

  it.each([
    ['a date outside the EDTF subset', (r: ReadingResult) => (r.entries[0]!.date = '12 March 1801')],
    ['a house number that is not digits', (r: ReadingResult) => (r.entries[0]!.house = '12?')],
    ['a house number given and also reported illegible', (r: ReadingResult) => (r.entries[0]!.illegible = [{ field: 'house', note: 'faded' }])],
    ['a date given and also reported illegible', (r: ReadingResult) => (r.entries[0]!.illegible = [{ field: 'date', note: 'torn' }])],
    ['a person’s house given and reported illegible', (r: ReadingResult) => (r.entries[0]!.illegible = [{ field: 'p2.house', note: 'blot' }])],
    ['the same person key twice', (r: ReadingResult) => (r.entries[0]!.persons[1]!.key = 'p1')],
    ['a hint naming a person of no entry', (r: ReadingResult) => (r.entries[0]!.hints[0]!.personKeys = ['p9'])],
    ['an entry on a page that was not read', (r: ReadingResult) => (r.entries[0]!.page = 1)],
    ['pages not numbered from 0', (r: ReadingResult) => (r.pages[0]!.page = 1)],
    ['a name without its language', (r: ReadingResult) => (r.entries[0]!.persons[0]!.names[0]!.language = 'Latin')],
    ['a role the Tree does not know', (r: ReadingResult) => Object.assign(r.entries[0]!.persons[0]!, { role: 'baby' })],
    ['a missing field (nothing is optional)', (r: ReadingResult) => Reflect.deleteProperty(r.entries[0]!, 'house')],
    ['a person without a name', (r: ReadingResult) => (r.entries[0]!.persons[0]!.names = [])],
  ])('refuses %s', (_what, change) => {
    const r = baptismPage();
    change(r);
    expect(issuesOf(r).length).toBeGreaterThan(0);
  });

  it('becomes a JSON Schema without optional properties, so the structured output asks for every field', () => {
    const schema = z.toJSONSchema(ReadingResult, { reused: 'ref' }) as { $defs?: Record<string, { properties?: object; required?: string[] }> };
    const entry = Object.values(schema.$defs ?? {}).find((d) => d.properties && 'transcription' in d.properties && 'persons' in d.properties);
    expect(entry?.required?.sort()).toEqual(Object.keys(entry!.properties!).sort());
  });

  it('maps a Name’s language to today’s Name types until Names carry a language (#17)', () => {
    expect([nameTypeForLanguage('la'), nameTypeForLanguage('de-Latf'), nameTypeForLanguage('cs'), nameTypeForLanguage('pl')]).toEqual([
      'latin',
      'german',
      'other',
      'other',
    ]);
  });
});

describe('reading requests', () => {
  it('refuses an archive viewer link instead of an image, saying what to do (scenario "Portal link")', () => {
    const r = CreateReadingBody.safeParse({ uploadIds: ['https://portal.example-archive.test/matriky/view?page=41'] });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe(PORTAL_LINK_MESSAGE);
    expect(isPortalLink('www.example-archive.test/scan/12')).toBe(true);
    expect(isPortalLink(ID(1))).toBe(false);
    // An image link in another field is no way round it: unknown fields are refused, and the link field is never fetched.
    expect(CreateReadingBody.safeParse({ uploadIds: [ID(1)], imageUrl: 'https://portal.example-archive.test/p41.jpg' }).success).toBe(false);
    const kept = CreateReadingBody.parse({ uploadIds: [ID(1)], context: { link: 'https://portal.example-archive.test/matriky/view?page=41' } });
    expect(kept.context.link).toBe('https://portal.example-archive.test/matriky/view?page=41');
  });

  it('checks crops: inside the image, of a scan that is read, one per scan', () => {
    const crop = { uploadId: ID(1), left: 0.1, top: 0.2, width: 0.5, height: 0.3 };
    expect(CreateReadingBody.safeParse({ uploadIds: [ID(1)], crops: [crop] }).success).toBe(true);
    expect(CreateReadingBody.safeParse({ uploadIds: [ID(1)], crops: [{ ...crop, left: 0.7 }] }).success).toBe(false);
    expect(CreateReadingBody.safeParse({ uploadIds: [ID(2)], crops: [crop] }).success).toBe(false);
    expect(CreateReadingBody.safeParse({ uploadIds: [ID(1)], crops: [crop, crop] }).success).toBe(false);
  });
});

describe('the switch, the daily limit and what is sent (proved; these are examples)', () => {
  it('reads nothing while switched off, and refuses at the daily limit', () => {
    expect(mayRead(false, 0, 10)).toEqual({ allowed: false, reason: 'off' });
    expect(mayRead(true, 10, 10)).toEqual({ allowed: false, reason: 'limit' });
    expect(mayRead(true, 9, 10)).toEqual({ allowed: true, reason: 'ok' });
  });

  it('sends the crop or the display copy of each requested scan, and nothing while switched off', () => {
    const requested = [
      { uploadId: ID(1), crop: true },
      { uploadId: ID(2), crop: false },
    ];
    expect(imagesToSend(true, requested)).toEqual([
      { uploadId: ID(1), copy: 'crop' },
      { uploadId: ID(2), copy: 'display' },
    ]);
    expect(imagesToSend(false, requested)).toEqual([]);
  });

  it('caps the confidence of a Citation the reader drafted at normal, and clears the mark of a value the Member confirmed or changed', () => {
    expect(['very_low', 'low', 'normal', 'high', 'very_high'].map((c) => capConfidence(c, true))).toEqual(['very_low', 'low', 'normal', 'normal', 'normal']);
    expect(capConfidence('very_high', false)).toBe('very_high');
    expect(stillReadByAi(true, false, false)).toBe(true);
    expect(stillReadByAi(true, true, false)).toBe(false);
    expect(stillReadByAi(true, false, true)).toBe(false);
    expect(stillReadByAi(false, false, false)).toBe(false);
  });
});

describe('matching read names (scenario "Known father")', () => {
  // "Joannes Nowak, colonus N. 12" as father at a baptism of 1801.
  const window = birthWindow('father', 1801)!;
  const read: ReadFacts = {
    givens: nameVariants('Joannes', 'given'),
    surnames: nameVariants('Nowak', 'surname'),
    house: '12',
    placeId: ID(500),
    hasWindow: true,
    windowFrom: window.from,
    windowTo: window.to,
  };
  // Jan Novák of čp. 12, born 1770.
  const jan: CandidateFacts = {
    givens: nameVariants('Jan', 'given'),
    surnames: nameVariants('Novák', 'surname'),
    houses: ['12'],
    placeIds: [ID(500)],
    hasBirth: true,
    birthFrom: 1770,
    birthTo: 1770,
    family: false,
  };
  // A Jan Nowak of the same Place and years, but of another House, married to someone else.
  const namesake: CandidateFacts = { ...jan, givens: nameVariants('Johann', 'given'), surnames: nameVariants('Nowak', 'surname'), houses: ['31'] };
  const stranger: CandidateFacts = { ...jan, givens: nameVariants('Josef', 'given'), surnames: nameVariants('Dvořák', 'surname'), family: true };

  it('suggests Jan Novák with the reasons: name and its variants, House, years and Place', () => {
    const s = scoreCandidate(read, jan);
    expect(s.reasons).toEqual({ name: true, house: true, years: true, place: true, family: false });
    expect(isSuggested(read, jan)).toBe(true);
    expect(isSuggested(read, stranger)).toBe(false);
  });

  it('ranks him above a namesake of another House, and a stranger never above him', () => {
    expect(ranksAbove(read, jan, namesake)).toBe(true);
    expect(ranksAbove(read, jan, stranger)).toBe(true);
    expect(ranksAbove(read, stranger, jan)).toBe(false);
  });

  it('folds register spellings and other language forms of names together', () => {
    expect(nameVariants('Nowakowa', 'surname')).toContain('novak');
    expect(nameVariants('Nováková', 'surname')).toContain('novak');
    expect(nameVariants('Wenceslaus', 'given')).toContain('vaclav');
    expect(nameVariants('Catharina', 'given')).toContain('katerina');
    expect(nameVariants('Thomas', 'given')).toContain('tomas');
  });
});

describe('suggested leads (scenario "Parents\' marriage")', () => {
  it('suggests finding the parents’ marriage in the same Parish before 1801, naming a register of the Tree that covers the years', () => {
    const leads = leadSuggestions(baptismPage(), {
      parish: 'Dolní Kamenec',
      archive: 'Invented Regional Archive',
      place: 'Kamenná Lhota',
      registers: [
        { sourceId: ID(70), title: 'Invented register of marriages 1784–1820', kinds: ['marriage'], from: 1784, to: 1820 },
        { sourceId: ID(71), title: 'Invented register of births 1784–1820', kinds: ['baptism'], from: 1784, to: 1820 },
      ],
    });
    const marriage = leads.find((l) => l.kind === 'parents_marriage')!;
    expect(marriage.question.en).toBe('Find the marriage of Joannes Nowak and Catharina nata Swoboda before 1801 (Parish: Dolní Kamenec)');
    expect(marriage.question.cs).toContain('před rokem 1801');
    expect(marriage.years).toEqual({ from: 1776, to: 1801 });
    expect(marriage.personKeys).toEqual(['p2', 'p3']);
    expect([marriage.sourceId, marriage.sourceTitle, marriage.archive]).toEqual([
      ID(70),
      'Invented register of marriages 1784–1820',
      'Invented Regional Archive',
    ]);
    // The reader's own hint follows: the godparent's House.
    expect(leads.map((l) => l.kind)).toEqual(['parents_marriage', 'godparent_house']);
    expect(leads[1]!.question.en).toBe('Find who lived at čp. 7 of Kamenná Lhota: Mathias Horak');
  });

  it('suggests no parents’ marriage without both parents', () => {
    const page = baptismPage();
    page.entries[0]!.persons = page.entries[0]!.persons.filter((p) => p.role !== 'mother');
    expect(leadSuggestions(page, { parish: null, archive: null, place: null, registers: [] }).map((l) => l.kind)).toEqual(['godparent_house']);
  });
});

describe('a Proposal from a reading, for an Agent', () => {
  const base = {
    result: baptismPage(),
    uploadIds: [ID(900)],
    source: { title: 'Invented register N 1784–1820' },
    page: '41',
    placeId: ID(500),
    readOn: '2026-11-02',
  };

  it('creates nobody without a choice', () => {
    expect(unchosenPersons(base.result, { p1: 'new' })).toEqual(['p2', 'p3', 'p4', 'p5']);
    expect(() => readingOperations({ ...base, persons: { p1: 'new' } })).toThrow(/p2, p3, p4, p5/);
  });

  it('adds the baptism with its Roles, links the father it was matched to, and marks every value as read by AI', () => {
    const { operations, marks } = readingOperations({ ...base, persons: { p1: 'new', p2: ID(7), p3: 'new', p4: 'new', p5: 'new' } });
    const check = checkOperations(operations, { editor: false });
    expect(check.issues).toEqual([]);
    expect(operations.filter((o) => o.op === 'createPerson')).toHaveLength(4);
    expect(operations).toContainEqual({ op: 'addRole', eventId: 'tmp:e1', personId: ID(7), role: 'father', roleDetail: null });
    expect(operations.find((o) => o.op === 'createCitation')).toMatchObject({ confidence: 'normal', page: '41' });
    expect(operations.find((o) => o.op === 'addImage')).toMatchObject({ uploadId: ID(900), kind: 'page' });
    // Names keep their spelling and language: the child's Latin form.
    expect(operations.find((o) => o.op === 'createPerson')).toMatchObject({ name: { given: 'Wenceslaus', type: 'latin', asFound: 'Wenceslaus' } });
    // The event is at the Place, with the unresolved house number in its description.
    expect(operations.find((o) => o.op === 'createEvent')).toMatchObject({ placeId: ID(500), houseId: null, description: 'čp. 12', date: '1801-03-12' });
    expect(ReaderInfo.safeParse({ readingIds: [ID(1)], marks }).success).toBe(true);
    const marked = (op: string) => marks.filter((m) => operations[m.position]!.op === op);
    expect(marked('createPerson')).toHaveLength(4);
    expect(marked('createEvent')[0]!.fields).toEqual(['type', 'date', 'description']);
    expect(marked('createCitation')[0]!.fields).toEqual(['transcription']);
  });

  it('uses the House the Tree has for the number, instead of describing it', () => {
    const { operations } = readingOperations({ ...base, houses: [ID(600)], persons: { p1: 'new', p2: 'new', p3: 'new', p4: 'new', p5: 'new' } });
    expect(operations.find((o) => o.op === 'createEvent')).toMatchObject({ placeId: null, houseId: ID(600), description: null });
    expect(checkOperations(operations, { editor: false }).issues).toEqual([]);
  });
});
