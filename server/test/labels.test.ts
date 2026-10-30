import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../src/fixture/generate.js';
import { labelsFor } from '../src/proposals/labels.js';
import { createTestDatabase, type TestDatabase } from './db.js';

const L = generateFixture().landmarks;

describe('labels of existing records in review and history sentences', () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => t?.drop());

  it('names a Role in the reader\'s language', async () => {
    const godparent = await t.db.selectFrom('event_role').select('id').where('event_id', '=', L.janBaptism).where('role', '=', 'godparent').executeTakeFirstOrThrow();
    const labels = await labelsFor(t.db, [godparent.id]);
    expect(labels.label(godparent.id, 'cs')).toMatch(/\(kmotr\)$/);
    expect(labels.label(godparent.id, 'en')).toMatch(/\(godparent\)$/);
  });

  it('labels a House by its Place and every number it carried', async () => {
    const labels = await labelsFor(t.db, [L.houseA]);
    expect(labels.label(L.houseA, 'cs')).toBe('Kamenná Lhota čp. 12/15');
    expect(labels.label(L.houseA, 'en')).toBe('Kamenná Lhota No. 12/15');
  });
});
