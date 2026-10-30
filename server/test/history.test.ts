import { History, type OperationInput } from '@rodokmen/shared';
import { randomBytes } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/db.js';
import type { Database } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { recordHistory } from '../src/proposals/history.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

const L = generateFixture().landmarks;

/** An Editor's direct change citing an invented register entry for Jan Novák's death. */
const citeDeath = (tag: string): OperationInput[] => [
  { op: 'createSource', tempId: `tmp:s${tag}`, type: 'parish_register', title: `Invented register ${tag}` },
  { op: 'createCitation', tempId: `tmp:c${tag}`, sourceId: `tmp:s${tag}`, page: '3', transcription: 'Invented entry.', readOn: '2026-10-01', confidence: 'normal' },
  { op: 'attachCitation', citationId: `tmp:c${tag}`, eventId: L.janDeath, baseVersion: 1 },
];

describe('history of a record', () => {
  let t: TestDatabase;
  let a: TestApp;
  let cookie: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    await ensureOwner(t.db);
    cookie = await signIn(t.db, a.clock, await createMember(t.db, 'editor'));
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  const accept = async (tag: string) => {
    const payload = { formatVersion: 1, idempotencyKey: randomBytes(9).toString('base64url'), note: null, direct: true, operations: citeDeath(tag) };
    expect((await a.app.inject({ method: 'POST', url: '/api/proposals', headers: { cookie }, payload })).statusCode).toBe(201);
  };

  /** recordHistory on a connection that counts the queries it runs. */
  const countedHistory = async () => {
    let queries = 0;
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: createPool(t.url, { max: 1 }) }), log: (e) => void (e.level === 'query' && queries++) });
    try {
      const items = await recordHistory(db, 'event', L.janDeath);
      return { items, queries };
    } finally {
      await db.destroy();
    }
  };

  it('takes the same number of queries for one entry as for many', async () => {
    await accept('A');
    const one = await countedHistory();
    for (const tag of ['B', 'C', 'D', 'E']) await accept(tag);
    const five = await countedHistory();
    expect(History.parse({ items: five.items }).items).toHaveLength(one.items.length + 4);
    expect(five.queries).toBe(one.queries);
  });
});
