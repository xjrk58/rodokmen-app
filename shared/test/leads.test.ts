import { describe, expect, it } from 'vitest';
import { exportedPersonLinks, leadsOnAccept, leadsOnUndo, LEAD_STATUSES, mayHaveStatus, type LeadState } from '../src/leads.js';
import { CloseLeadBody, CreateLeadBody, LeadListQuery, SearchRecordBody, UpdateLeadBody } from '../src/schemas/leads.js';

const ID = (n: number) => `0192f0c4-7a1e-7c3b-9d2a-${String(n).padStart(12, '0')}`;

describe('closing as not found (research-leads: What was searched is recorded)', () => {
  it('needs at least one search record', () => {
    expect(mayHaveStatus('not_found', 0)).toBe(false);
    expect(mayHaveStatus('not_found', 1)).toBe(true);
    expect(mayHaveStatus('not_found', 3)).toBe(true);
  });
  it('open, in progress and found need none', () => {
    for (const status of ['open', 'in_progress', 'found']) expect(mayHaveStatus(status, 0), status).toBe(true);
  });
  it('refuses any other status', () => {
    expect(mayHaveStatus('closed', 5)).toBe(false);
    expect(LEAD_STATUSES).toEqual(['open', 'in_progress', 'found', 'not_found']);
  });
});

describe('leads answered by a Proposal (research-leads: Findings link back to leads)', () => {
  const leads: LeadState[] = [
    { id: 'a', status: 'open', foundBy: '' },
    { id: 'b', status: 'in_progress', foundBy: '' },
    { id: 'c', status: 'not_found', foundBy: '' },
  ];
  it('accepting marks exactly the named leads found, linked to the Proposal', () => {
    expect(leadsOnAccept(leads, ['a', 'c'], 'p1')).toEqual([
      { id: 'a', status: 'found', foundBy: 'p1' },
      leads[1],
      { id: 'c', status: 'found', foundBy: 'p1' },
    ]);
    expect(leadsOnAccept(leads, [], 'p1')).toEqual(leads);
  });
  it('undoing reopens exactly the leads it marked found, never one found by hand or by another Proposal', () => {
    const after = leadsOnAccept(leads, ['a'], 'p1');
    const mixed: LeadState[] = [...after, { id: 'd', status: 'found', foundBy: '' }, { id: 'e', status: 'found', foundBy: 'p2' }];
    expect(leadsOnUndo(mixed, 'p1')).toEqual([{ id: 'a', status: 'open', foundBy: '' }, leads[1], leads[2], mixed[3], mixed[4]]);
    expect(leadsOnUndo(mixed, '')).toEqual(mixed);
  });
});

describe('leads in an Export (exports: Living people are reduced in every Export)', () => {
  it('drops links to Living people and keeps the others', () => {
    const r = exportedPersonLinks([
      { personId: 'jan', living: false },
      { personId: 'eliska', living: true },
    ]);
    expect(r).toEqual({ include: true, persons: [{ personId: 'jan', living: false }] });
  });
  it('leaves out a lead about Living people only, and keeps one about nobody in particular', () => {
    expect(exportedPersonLinks([{ personId: 'eliska', living: true }])).toEqual({ include: false, persons: [] });
    expect(exportedPersonLinks([])).toEqual({ include: true, persons: [] });
  });
});

describe('lead payloads', () => {
  it('a lead needs a question and its reason', () => {
    expect(CreateLeadBody.safeParse({ question: 'Find the baptism', reason: '' }).success).toBe(false);
    const lead = CreateLeadBody.parse({ question: 'Find the baptism', reason: 'Born about 1801' });
    expect(lead).toMatchObject({ status: 'open', personIds: [], placeIds: [], searches: [], years: null, sourceId: null });
  });
  it('years end after they start, and Persons and Places are named once', () => {
    expect(CreateLeadBody.safeParse({ question: 'q', reason: 'r', years: { from: 1820, to: 1784 } }).success).toBe(false);
    expect(CreateLeadBody.safeParse({ question: 'q', reason: 'r', personIds: [ID(1), ID(1)] }).success).toBe(false);
  });
  it('a search record names the Source or the archive', () => {
    expect(SearchRecordBody.safeParse({ found: false }).success).toBe(false);
    expect(SearchRecordBody.safeParse({ found: false, archive: '  ' }).success).toBe(false);
    expect(SearchRecordBody.parse({ found: false, archive: 'Invented archive', years: { from: 1798, to: 1805 }, pages: '1–60' })).toMatchObject({
      sourceId: null,
      note: null,
    });
  });
  it('an edit names the version seen and changes something', () => {
    expect(UpdateLeadBody.safeParse({ baseVersion: 1 }).success).toBe(false);
    expect(UpdateLeadBody.parse({ baseVersion: 1, status: 'in_progress' })).toEqual({ baseVersion: 1, status: 'in_progress' });
    expect(CloseLeadBody.safeParse({ baseVersion: 1, status: 'open' }).success).toBe(false);
  });
  it('the list filters by several statuses', () => {
    expect(LeadListQuery.parse({ status: 'open,in_progress' }).status).toEqual(['open', 'in_progress']);
    expect(LeadListQuery.safeParse({ status: 'open,closed' }).success).toBe(false);
  });
});
