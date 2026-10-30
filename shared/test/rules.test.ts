import { describe, expect, it } from 'vitest';
import { detectConflict, mayDecide, permissionsFor, satisfiesEvidenceRule, undoBlockers } from '../src/index.js';

describe('who may accept, reject or merge', () => {
  it('Editors and the Owner only; never Contributors or Agents', () => {
    expect(['owner', 'editor', 'contributor', 'agent', '', 'Editor'].map(mayDecide)).toEqual([true, true, false, false, false, false]);
    for (const role of ['contributor', 'editor', 'owner'] as const) expect(permissionsFor(role).review).toBe(mayDecide(role));
  });
});

describe('the evidence rule', () => {
  it('needs at least one Citation, created or attached', () => {
    expect(satisfiesEvidenceRule(['createPerson', 'createEvent', 'addRole'])).toBe(false);
    expect(satisfiesEvidenceRule(['createPerson', 'createSource', 'createCitation'])).toBe(true);
    expect(satisfiesEvidenceRule(['setField', 'attachCitation'])).toBe(true);
    expect(satisfiesEvidenceRule([])).toBe(false);
  });
  it('a Family account Source is cited like any other, so it counts', () => {
    // createSource(type family_account) + createCitation of it
    expect(satisfiesEvidenceRule(['createSource', 'createCitation', 'attachCitation'])).toBe(true);
  });
  it('merges and undo steps change no facts and need none, unless mixed with facts', () => {
    expect(satisfiesEvidenceRule(['mergePersons'])).toBe(true);
    expect(satisfiesEvidenceRule(['restoreRecord', 'restoreRecord'])).toBe(true);
    expect(satisfiesEvidenceRule(['mergePersons', 'setField'])).toBe(false);
  });
});

describe('conflict detection', () => {
  it('no conflict while the base version is current', () => {
    expect(detectConflict(3, 3, [{ field: 'date', value: '1850' }], [{ field: 'date', value: '1849' }])).toBeNull();
  });
  it('a changed record lists each field it sets next to the current value', () => {
    expect(detectConflict(3, 4, [{ field: 'date', value: '1850-11-13' }, { field: 'placeId', value: null }], [{ field: 'date', value: '1850-11-04' }])).toEqual({
      baseVersion: 3,
      currentVersion: 4,
      fields: [
        { field: 'date', proposed: '1850-11-13', current: '1850-11-04' },
        { field: 'placeId', proposed: null, current: null },
      ],
    });
  });
  it('a record that is gone is a conflict without fields', () => {
    expect(detectConflict(2, null, [{ field: 'date', value: '1850' }], [])).toEqual({ baseVersion: 2, currentVersion: null, fields: [] });
  });
});

describe('the undo dependency check', () => {
  const person = { table: 'person', id: 'p' };
  const childName = { table: 'name', id: 'n1' };
  const laterName = { table: 'name', id: 'n2' };
  const laterRole = { table: 'event_role', id: 'r9' };
  const touch = (proposalId: string, acceptedAt: number, record: { table: string; id: string }, undone = false) => ({ proposalId, acceptedAt, record, undone });

  it('dependents the undo removes itself do not block', () => {
    expect(undoBlockers('X', [person, childName], [{ of: person, dependent: childName }], [touch('X', 1, childName)])).toEqual({ blockedBy: [], unlogged: false });
  });
  it('later Proposals that attached records are named, newest first, once each', () => {
    const result = undoBlockers(
      'X',
      [person],
      [
        { of: person, dependent: laterName },
        { of: person, dependent: laterRole },
      ],
      [touch('Y', 10, laterName), touch('Z', 20, laterRole), touch('Y', 10, laterRole), touch('X', 1, person)],
    );
    expect(result).toEqual({ blockedBy: ['Z', 'Y'], unlogged: false });
  });
  it('Proposals already undone do not count; a dependent nobody logged still blocks', () => {
    expect(undoBlockers('X', [person], [{ of: person, dependent: laterName }], [touch('Y', 10, laterName, true)])).toEqual({ blockedBy: [], unlogged: true });
  });
  it('no deletions, no blockers', () => {
    expect(undoBlockers('X', [], [{ of: person, dependent: laterName }], [touch('Y', 10, laterName)])).toEqual({ blockedBy: [], unlogged: false });
  });
});
