import { describe, expect, it } from 'vitest';
import { compareEarliestDays } from '../src/tree/summaries.js';

describe('the order of Events by their earliest day', () => {
  it('puts open starts first and undated Events last', () => {
    const days = ['1801-03-12', null, '-infinity', '1790-05-01', '0999-12-31', null, '1801-03-12'];
    expect([...days].sort(compareEarliestDays)).toEqual(['-infinity', '0999-12-31', '1790-05-01', '1801-03-12', '1801-03-12', null, null]);
  });
});
