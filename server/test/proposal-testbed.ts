import { PersonDetail, type OperationInput } from '@rodokmen/shared';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';
import type { Account } from '../src/db/types.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

/** A fresh idempotency key, as one Draft has. */
export const newKey = () => randomBytes(9).toString('base64url');

/** A register Citation, as every Proposal needs one (invented Source). */
export function citation(tag: string, extra: Partial<Record<string, unknown>> = {}): OperationInput[] {
  return [
    { op: 'createSource', tempId: `tmp:src${tag}`, type: 'parish_register', title: `Invented register ${tag}`, repository: 'Invented archive' },
    { op: 'createCitation', tempId: `tmp:cit${tag}`, sourceId: `tmp:src${tag}`, page: '17', transcription: 'Invented transcription of the entry.', readOn: '2026-10-01', confidence: 'high', ...extra },
  ];
}

export interface Testbed {
  t: TestDatabase;
  a: TestApp;
  owner: Account;
  editor: Account;
  contributor: Account;
  other: Account;
}

/**
 * The world of the Proposal tests: a fresh database with the fixture Tree, the app, an Owner, an
 * Editor and two Contributors, all signed in. Call inside a describe; `ready()` returns the bed
 * once beforeAll has run.
 */
export function useProposalTestbed() {
  let bed: Testbed | undefined;
  const cookies = new Map<string, string>();
  const ready = (): Testbed => {
    if (!bed) throw new Error('the Proposal test bed is set up in beforeAll');
    return bed;
  };

  beforeAll(async () => {
    const t = await createTestDatabase();
    const a = await makeApp(t);
    const owner = await ensureOwner(t.db);
    const editor = await createMember(t.db, 'editor', { displayName: 'Eva Editor' });
    const contributor = await createMember(t.db, 'contributor', { displayName: 'Karel Contributor', language: 'cs' });
    const other = await createMember(t.db, 'contributor', { displayName: 'Olga Other' });
    for (const m of [owner, editor, contributor, other]) cookies.set(m.id, await signIn(t.db, a.clock, m));
    bed = { t, a, owner, editor, contributor, other };
  });
  afterAll(async () => {
    await bed?.a.app.close();
    await bed?.t.drop();
  });

  const call = (m: Account, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    ready().a.app.inject({ method, url, headers: { cookie: cookies.get(m.id)! }, ...(payload === undefined ? {} : { payload }) });
  const submit = (m: Account, operations: OperationInput[], extra: Record<string, unknown> = {}) =>
    call(m, 'POST', '/api/proposals', { formatVersion: 1, idempotencyKey: newKey(), note: null, operations, ...extra });
  const person = async (id: string, m: Account = ready().contributor) => PersonDetail.parse((await call(m, 'GET', `/api/persons/${id}`)).json());
  const count = async (table: 'person' | 'name' | 'event' | 'event_role' | 'log_entry' | 'proposal') =>
    (await ready().t.db.selectFrom(table).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n;

  return { ready, call, submit, person, count };
}
