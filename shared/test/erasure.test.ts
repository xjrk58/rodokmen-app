import { describe, expect, it } from 'vitest';
import { afterReapplying, citationsLeft, mayErase, rewriteLog, theirRows, theirsAlone, toEraseAgain } from '../src/erasure.js';

describe('erasure rules', () => {
  it('erases only a Living person, and only when the confirmation names them', () => {
    expect(mayErase(true, 'anna vzorová', 'anna vzorová')).toBe(true);
    expect(mayErase(false, 'anna vzorová', 'anna vzorová')).toBe(false);
    expect(mayErase(true, 'someone else', 'anna vzorová')).toBe(false);
    expect(mayErase(true, '', '')).toBe(false);
  });

  it('takes the Events and images that are theirs alone, and the rows that are theirs', () => {
    const events = [
      { id: 'birth', persons: ['p'] },
      { id: 'twice', persons: ['p', 'p'] },
      { id: 'shared', persons: ['p', 'q'] },
      { id: 'empty', persons: [] },
    ];
    expect(theirsAlone(events, 'p').map((e) => e.id)).toEqual(['birth', 'twice']);
    const rows = [
      { table: 'name', id: 'n1', personId: 'p' },
      { table: 'name', id: 'n2', personId: 'q' },
    ];
    expect(theirRows(rows, 'p')).toEqual([rows[0]]);
  });

  it('takes a Citation only when everything it is attached to goes', () => {
    const citations = [
      { id: 'c1', attachedTo: ['birth'] },
      { id: 'c2', attachedTo: ['birth', 'shared'] },
      { id: 'c3', attachedTo: [] },
    ];
    expect(citationsLeft(citations, ['birth', 'name1']).map((c) => c.id)).toEqual(['c1']);
  });

  it('turns every log entry that mentions an erased record into a marker, and changes no other (scenario "History after erasure")', () => {
    const items = [
      { id: '1', mentions: ['p', 'f'], data: '{"given":"Anna"}', erased: false, at: '' },
      { id: '2', mentions: ['q'], data: '{"given":"Jan"}', erased: false, at: '' },
    ];
    expect(rewriteLog(items, ['p'], '2026-11-05T10:00:00.000Z')).toEqual([
      { id: '1', mentions: [], data: '', erased: true, at: '2026-11-05T10:00:00.000Z' },
      items[1],
    ]);
  });

  it('erases again exactly the listed Persons a restored Backup holds (scenario "Restore from an old Backup")', () => {
    expect(toEraseAgain(['a', 'b', 'c'], ['b', 'x'])).toEqual(['b']);
    expect(afterReapplying(['a', 'b', 'c'], ['b', 'x'])).toEqual(['a', 'c']);
  });
});
