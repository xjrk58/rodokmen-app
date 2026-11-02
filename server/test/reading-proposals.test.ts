import { ApiError, ProposalList, ProposalView, type ReadingResult } from '@rodokmen/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { housesFor, matchesFor } from '../src/readings/candidates.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { TestClock } from './helpers.js';
import { page, useReadingWorld } from './reading-world.js';

const L = generateFixture().landmarks;

/**
 * Proposals drafted from readings, and matching read names to the Tree (scan-reading spec, "The
 * machine's reading is marked and modest" and "Names are matched, not duplicated";
 * add-scan-reading tasks 2.1 and 2.2).
 */
describe('Proposals from readings', () => {
  const world = useReadingWorld();
  let as: ReturnType<typeof world>['as'];
  let upload: ReturnType<typeof world>['upload'];
  let read: ReturnType<typeof world>['read'];
  let contributor: Account;
  let editor: Account;
  let t: ReturnType<typeof world>['t'];
  beforeEach(() => {
    ({ as, upload, read, contributor, editor, t } = world());
  });

  describe('Proposals drafted from a reading (task 2.1)', () => {
    const ops = (uploadId: string | null, confidence: string) => [
      { op: 'createSource', tempId: 'tmp:s', type: 'parish_register', title: 'Invented register N 1820–1840' },
      {
        op: 'createCitation',
        tempId: 'tmp:c',
        sourceId: 'tmp:s',
        page: '41',
        transcription: 'Die 14. Martii baptizata est Anna',
        readOn: '2026-11-02',
        confidence,
      },
      { op: 'createEvent', tempId: 'tmp:e', type: 'baptism', date: '1830-03-14', placeId: L.kamennaLhota },
      { op: 'createPerson', tempId: 'tmp:p1', sex: 'female', name: { given: 'Anna', surname: 'Nováková', type: 'latin', asFound: 'Anna' } },
      { op: 'addRole', eventId: 'tmp:e', personId: 'tmp:p1', role: 'child' },
      { op: 'attachCitation', citationId: 'tmp:c', eventId: 'tmp:e' },
      ...(uploadId ? [{ op: 'addImage', uploadId, kind: 'page', citationId: 'tmp:c' }] : []),
    ];
    const submit = async (member: Account, body: object) => {
      const res = await as(member, 'POST', '/api/proposals', { formatVersion: 1, idempotencyKey: `read-${randomUUID()}`, note: 'Baptism of Anna', ...body });
      expect(res.statusCode, res.body).toBe(201);
      return ProposalView.parse(res.json());
    };
    const confidenceOf = (p: ProposalView) => p.operations.map((o) => o.operation).find((o) => o.op === 'createCitation')!;

    it('lowers a submitted high confidence to normal, and keeps the "read by AI" marks of values the Member did not confirm or correct (scenario "Member confirms")', async () => {
      const scan = await upload(contributor, await page());
      const reading = await read(contributor, { uploadIds: [scan] });
      // The surname was corrected (Nowakowa → Nováková) and the entry confirmed: only the unconfirmed transcription stays marked.
      const marks = [{ position: 1, fields: ['transcription'] }];
      const p = await submit(contributor, { operations: ops(scan, 'very_high'), reader: { readingIds: [reading.id], marks } });
      expect(confidenceOf(p)).toMatchObject({ confidence: 'normal' });
      expect(p.reader).toEqual({ readingIds: [reading.id], marks });
      const stored = await t.db.selectFrom('proposal').select('reader').where('id', '=', p.id).executeTakeFirstOrThrow();
      expect(stored.reader).toEqual({ readingIds: [reading.id], marks });
      // The Editor sees the same in the review queue.
      const queue = ProposalList.parse((await as(editor, 'GET', '/api/review?limit=100')).json());
      expect(queue.items.find((x) => x.id === p.id)!.reader!.marks).toEqual(marks);
    });

    it('caps the confidence also when the Proposal does not say it was read, but its image was', async () => {
      const scan = await upload(contributor, await page());
      await read(contributor, { uploadIds: [scan] });
      expect(confidenceOf(await submit(contributor, { operations: ops(scan, 'high') }))).toMatchObject({ confidence: 'normal' });
      expect(confidenceOf(await submit(contributor, { operations: ops(null, 'high') }))).toMatchObject({ confidence: 'high' });
      expect(confidenceOf(await submit(contributor, { operations: ops(await upload(contributor, await page()), 'low') }))).toMatchObject({ confidence: 'low' });
    });

    it('refuses marks of a reading that is not the author’s, or that point nowhere', async () => {
      const reading = await read(editor, { uploadIds: [await upload(editor, await page())] });
      const res = await as(contributor, 'POST', '/api/proposals', {
        formatVersion: 1,
        idempotencyKey: `read-${randomUUID()}`,
        operations: ops(null, 'normal'),
        reader: { readingIds: [reading.id], marks: [] },
      });
      expect([res.statusCode, ApiError.parse(res.json()).code]).toEqual([400, 'unknown_reading']);
      const own = await read(contributor, { uploadIds: [await upload(contributor, await page())] });
      const outside = await as(contributor, 'POST', '/api/proposals', {
        formatVersion: 1,
        idempotencyKey: `read-${randomUUID()}`,
        operations: ops(null, 'normal'),
        reader: { readingIds: [own.id], marks: [{ position: 40, fields: ['date'] }] },
      });
      expect(outside.statusCode).toBe(400);
    });
  });
});

describe('the candidate query (task 2.2; scenario "Known father")', () => {
  let t: TestDatabase;
  const clock = new TestClock(new Date('2026-11-02T09:00:00Z'));
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.drop();
  });

  // "Thomas Nowak, colonus N. 12" as the father of a child baptised in 1801: the Tree has Tomáš Novák of čp. 12, born 1772.
  const reading = (father: { given: string; surname: string; house: string | null }, date = '1801-03-12'): ReadingResult => ({
    pages: [{ page: 0, transcription: 'invented', languages: ['la'] }],
    entries: [
      {
        page: 0,
        type: 'baptism',
        typeDetail: null,
        date,
        dateAsWritten: null,
        house: father.house,
        place: null,
        transcription: 'invented',
        persons: [
          {
            key: 'p1',
            role: 'child',
            roleDetail: null,
            sex: 'male',
            names: [{ given: 'Joannes', surname: '', asWritten: 'Joannes', language: 'la' }],
            description: null,
            house: null,
            residence: null,
          },
          {
            key: 'p2',
            role: 'father',
            roleDetail: null,
            sex: 'male',
            names: [{ given: father.given, surname: father.surname, asWritten: `${father.given} ${father.surname}`, language: 'la' }],
            description: 'colonus',
            house: father.house,
            residence: null,
          },
          {
            key: 'p3',
            role: 'mother',
            roleDetail: null,
            sex: 'female',
            names: [{ given: 'Maria', surname: '', asWritten: 'Maria', language: 'la' }],
            description: null,
            house: null,
            residence: null,
          },
        ],
        illegible: [],
        hints: [],
      },
    ],
    note: null,
  });

  it('suggests the known father first, with the reasons: name and variants, House, years and Place', async () => {
    const matches = await matchesFor(t.db, clock, reading({ given: 'Thomas', surname: 'Nowak', house: '12' }), L.kamennaLhota);
    const father = matches.find((m) => m.key === 'p2')!;
    expect(father.candidates.length).toBeGreaterThan(0);
    const first = father.candidates[0]!;
    expect(first.person.displayName).toBe('Tomáš Novák');
    expect(first.person.birth).toMatch(/^1772/);
    expect(first.reasons).toMatchObject({ name: true, house: true, years: true, place: true });
    // Everyone after him lacks the name, the House or the years.
    for (const other of father.candidates.slice(1)) expect(other.reasons.name && other.reasons.house && other.reasons.years).toBe(false);
    expect(await housesFor(t.db, reading({ given: 'Thomas', surname: 'Nowak', house: '12' }), L.kamennaLhota)).toEqual([L.houseA]);
  });

  it('does not suggest anyone whose given name and surname both do not match, and none from the model', async () => {
    const matches = await matchesFor(t.db, clock, reading({ given: 'Bartholomaeus', surname: 'Nowak', house: null }), L.kamennaLhota);
    for (const c of matches.find((m) => m.key === 'p2')!.candidates) expect(c.reasons.name).toBe(true);
    const none = await matchesFor(t.db, clock, reading({ given: 'Ignatius', surname: 'Invented', house: null }), L.kamennaLhota);
    expect(none.find((m) => m.key === 'p2')!.candidates).toEqual([]);
  });

  it('matches across register spellings: "Wenceslaus Dworzak" finds a Václav Dvořák', async () => {
    const matches = await matchesFor(t.db, clock, reading({ given: 'Wenceslaus', surname: 'Dworzak', house: null }, '1830-05-02'), null);
    const names = matches.find((m) => m.key === 'p2')!.candidates.map((c) => c.person.surname);
    for (const surname of names) expect(['Dvořák', 'Dvořáková']).toContain(surname);
  });
});
