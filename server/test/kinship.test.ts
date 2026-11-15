import {
  buildKinshipGraph,
  Hourglass,
  Kinship,
  KinshipSearch,
  kinshipPaths,
  Me,
  PersonDetail,
  PersonSearchResult,
  ProposalView,
  type OperationInput,
} from '@rodokmen/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { gatherKinshipData, linkCopy } from '../src/tree/kinship.js';
import type { TestDatabase } from './db.js';
import { expectGoldenJson } from './golden.js';
import { bearer, createAgentWithToken, errorOf } from './helpers.js';
import { citation, useProposalTestbed } from './proposal-testbed.js';

// add-kinship tasks 4.2 to 4.4: the link copy, the route and the short form, against the
// invented Javorník family of the fixture Tree (server/src/fixture/generate.ts). Norbert, whom the
// Contributor's account is linked to, married his second cousin Radka.
const K = generateFixture().landmarks.kinship;
const GOLDEN = new URL('golden/kinship/', import.meta.url).pathname;

describe('kinship on the server (kinship spec)', () => {
  const { ready, call, submit } = useProposalTestbed();
  let t: TestDatabase;
  let owner: Account;
  let editor: Account;
  let reader: Account;
  let unlinked: Account;
  let agentToken = '';

  const kinship = async (m: Account, to: string, query = '') => {
    const res = await call(m, 'GET', `/api/persons/${to}/kinship${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return Kinship.parse(res.json());
  };
  const terms = (k: Kinship) => k.paths.map((p) => [p.kind, p.degree, p.possible ? `možná ${p.term.cs.text}` : p.term.cs.text]);
  const accept = async (operations: OperationInput[], direct = false) => {
    const p = ProposalView.parse((await submit(direct ? editor : reader, operations, direct ? { direct: true } : {})).json());
    if (!direct) expect((await call(editor, 'POST', `/api/proposals/${p.id}/accept`, {})).statusCode).toBe(200);
    return p.id;
  };

  beforeAll(async () => {
    ({ t, owner, editor, contributor: reader, other: unlinked } = ready());
    expect((await call(owner, 'PUT', `/api/members/${reader.id}/person`, { personId: K.norbert })).statusCode).toBe(200);
    agentToken = (await createAgentWithToken(t.db, ready().a.clock)).token;
  });

  it('a Member asks: every path from their own Person, the closest first ("A wife who is also a cousin")', async () => {
    const k = await kinship(reader, K.radka);
    expect([k.from, k.to, k.more, k.connection]).toEqual([K.norbert, K.radka, false, null]);
    expect(terms(k)).toEqual([
      ['partner', null, 'manželka'],
      ['birth', 6, 'sestřenice z 2. kolena'],
    ]);
    expect(k.paths[1]!.commonAncestors.sort()).toEqual([K.ignac, K.kristina].sort());
    // Every Person on the way is in the answer, as the tree shows them.
    const named = new Set(k.persons.map((p) => p.id));
    for (const s of k.paths[1]!.steps) expect(named.has(s.person)).toBe(true);
  });

  it('the fixture family, as golden answers (rewritten only with UPDATE_GOLDEN=1)', async () => {
    for (const [name, id] of Object.entries(K).map(([n, v]) => [n, String(v)] as const)) {
      if (name === 'felixFatherEvent') continue;
      expectGoldenJson(`${GOLDEN}norbert-to-${name}.json`, await kinship(reader, id));
    }
  });

  it('the scenarios of the spec on the fixture: great-grandfather, double cousins, half, step, foster', async () => {
    // His wife is his second cousin, so her kin are his kin by marriage too: one more path to each.
    expect(terms(await kinship(reader, K.ignac))).toEqual([
      ['birth', 3, 'praděd'],
      ['marriage', 3, 'sešvagřený'],
    ]);
    expect(terms(await kinship(reader, K.matous))).toEqual([
      ['birth', 5, 'strýc z 2. kolena'],
      ['birth', 5, 'strýc z 2. kolena'],
      ['marriage', 5, 'sešvagřený'],
    ]);
    expect(terms(await kinship(reader, K.felix))).toEqual([
      ['birth', 4, 'možná polorodý prastrýc'],
      ['marriage', 4, 'možná sešvagřený'],
    ]);
    // The second wife of his great-grandfather, by marriage of the 3rd degree.
    expect(terms(await kinship(reader, K.eliska))).toEqual([['marriage', 3, 'sešvagřená']]);
    // The foster child of his great-grandparents and his great-grandfather's stepson: no kinship, only a chain.
    const foster = await kinship(reader, K.teodor);
    expect([foster.paths, foster.connection?.marriages]).toEqual([[], 0]);
    // Silvestr is his second wife's son, and his step child link says so again (with no Citation): two paths.
    expect(terms(await kinship(editor, K.silvestr, `?from=${K.ignac}`))).toEqual([
      ['marriage', 1, 'nevlastní syn'],
      ['marriage', 1, 'možná nevlastní syn'],
    ]);
    // The foster link has no Citation in the fixture, so the pair reads "možná".
    expect(terms(await kinship(editor, K.teodor, `?from=${K.ignac}`))).toEqual([['foster', null, 'možná svěřený syn']]);
  });

  it('a Living cousin: a Living person on a path appears as the tree shows them, and the Export holds no kinship', async () => {
    const k = await kinship(reader, K.viktor);
    // His son, and through his wife also his second cousin once removed.
    expect(terms(k)).toEqual([
      ['birth', 1, 'syn'],
      ['birth', 7, 'synovec z 3. kolena'],
    ]);
    const viktor = k.persons.find((p) => p.id === K.viktor)!;
    expect(viktor.living).toBe(true);
    const tree = PersonDetail.parse((await call(reader, 'GET', `/api/persons/${K.norbert}`)).json());
    const child = tree.familiesAsPartner.flatMap((f) => f.children).find((c) => c.person.id === K.viktor)!.person;
    expect({ ...viktor, kinship: undefined }).toEqual({ ...child, kinship: undefined });
    // The Owner's GEDCOM download holds the family, and no kinship: nothing about it is stored.
    const gedcom = await call(owner, 'GET', '/api/export/family.ged');
    expect(gedcom.statusCode, gedcom.body).toBe(200);
    expect(gedcom.body).toContain('Javorník');
    expect(gedcom.body).not.toMatch(/kinship|sestřenice|second cousin|praděd|great-grandfather|z 2\. kolena/i);
  });

  it('an Agent names both, and gets what the Member gets with the first as their own Person', async () => {
    const res = await ready().a.app.inject({ method: 'GET', url: `/api/persons/${K.radka}/kinship?from=${K.norbert}`, headers: bearer(agentToken) });
    expect(res.statusCode, res.body).toBe(200);
    expect(Kinship.parse(res.json())).toEqual(await kinship(reader, K.radka));
  });

  it('no starting Person: an Agent without from, and a Member with no own Person, are refused with 422', async () => {
    const agent = await ready().a.app.inject({ method: 'GET', url: `/api/persons/${K.radka}/kinship`, headers: bearer(agentToken) });
    expect([agent.statusCode, errorOf(agent).code]).toEqual([422, 'no_own_person']);
    const member = await call(unlinked, 'GET', `/api/persons/${K.radka}/kinship`);
    expect([member.statusCode, errorOf(member).code]).toEqual([422, 'no_own_person']);
    expect((await call(reader, 'GET', `/api/persons/${K.radka}/kinship?from=0192f0c4-7a1e-7c3b-9d2a-000000000000`)).statusCode).toBe(404);
  });

  it('not signed in: 401', async () => {
    expect((await ready().a.app.inject({ method: 'GET', url: `/api/persons/${K.radka}/kinship` })).statusCode).toBe(401);
  });

  it("another Member's own Person: no answer says which Person another Member is", async () => {
    // The route takes no account id, and an answer for one Member names nobody's account.
    const k = JSON.stringify(await kinship(unlinked, K.radka, `?from=${K.ignac}`));
    for (const m of [reader, owner, editor]) {
      expect(k).not.toContain(m.id);
      expect(k).not.toContain(m.email!);
    }
    // The unlinked Member's search carries no kinship at all, so it cannot tell whom another is linked to.
    const hits = PersonSearchResult.parse((await call(unlinked, 'GET', '/api/persons?q=javornik')).json()).items;
    expect(hits.length).toBeGreaterThan(5);
    for (const h of hits) expect('kinship' in h.person).toBe(false);
  });

  it('same everywhere: search, the person page, the hourglass and the full answer name the same kinship', async () => {
    const hits = PersonSearchResult.parse((await call(reader, 'GET', '/api/persons?q=javornik')).json()).items;
    const ignac = hits.find((h) => h.person.id === K.ignac)!.person.kinship!;
    expect([ignac.term.cs.text, ignac.line, ignac.degree, ignac.others]).toEqual(['praděd', 'direct', 3, 1]);
    for (const h of hits) {
      const full = await kinship(reader, h.person.id);
      if (full.paths.length === 0) expect(h.person.kinship).toBeNull();
      else expect(h.person.kinship!.term).toEqual(full.paths[0]!.term);
    }
    const page = PersonDetail.parse((await call(reader, 'GET', `/api/persons/${K.karel}`)).json());
    expect(page.familiesAsPartner[0]!.children[0]!.person.kinship?.term.cs.text).toBe('vy');
    const tree = Hourglass.parse((await call(reader, 'GET', `/api/persons/${K.norbert}/hourglass?up=3&down=1`)).json());
    expect(tree.persons.find((p) => p.person.id === K.bartolomej)?.person.kinship?.term.cs.text).toBe('děd');
  });

  it('not linked: no kinship field at all; an Agent gets none either', async () => {
    const page = PersonDetail.parse((await call(unlinked, 'GET', `/api/persons/${K.karel}`)).json());
    expect('kinship' in page.familiesAsPartner[0]!.children[0]!.person).toBe(false);
    const res = await ready().a.app.inject({ method: 'GET', url: '/api/persons?q=javornik', headers: bearer(agentToken) });
    for (const h of PersonSearchResult.parse(res.json()).items) expect('kinship' in h.person).toBe(false);
  });

  it('records in another order give the same answer', async () => {
    const data = await gatherKinshipData(t.db);
    const reversed = { persons: [...data.persons].reverse(), families: [...data.families].reverse(), childLinks: [...data.childLinks].reverse() };
    const answer = (d: typeof data) => {
      const g = buildKinshipGraph(d);
      return kinshipPaths(new KinshipSearch(g, g.index.get(K.norbert)!), g.index.get(K.radka)!);
    };
    expect(answer(reversed)).toEqual(answer(data));
  });

  it('the Tree changes: each kind of change moves the state, and the next answer follows it (weak link, evidence improves)', async () => {
    const keys: string[] = [(await linkCopy(t.db)).key];
    const moved = async () => {
      const key = (await linkCopy(t.db)).key;
      expect(keys).not.toContain(key);
      keys.push(key);
    };
    // A Proposal: a Citation of high confidence on the weak father link of Felix.
    const felix = async () => (await kinship(reader, K.felix)).paths[0]!;
    expect([(await felix()).possible, (await felix()).term.cs.text]).toEqual([true, 'polorodý prastrýc']);
    const event = await t.db.selectFrom('event').select('version').where('id', '=', K.felixFatherEvent).executeTakeFirstOrThrow();
    const improvement = await accept([
      ...citation('FELIX'),
      { op: 'attachCitation', citationId: 'tmp:citFELIX', eventId: K.felixFatherEvent, baseVersion: event.version },
    ]);
    await moved();
    expect((await felix()).possible).toBe(false);
    // An undo.
    expect((await call(editor, 'POST', `/api/proposals/${improvement}/undo`, { note: null, choices: [] })).statusCode).toBe(200);
    await moved();
    expect((await felix()).possible).toBe(true);
    // A direct change by an Editor: a new Person.
    await accept(
      [
        { op: 'createPerson', tempId: 'tmp:q', sex: 'male', name: { given: 'Quido', surname: 'Invented', type: 'birth', asFound: 'Quido Inventus' } },
        ...citation('Q'),
      ],
      true,
    );
    await moved();
    // A Family root.
    expect((await call(owner, 'PUT', `/api/persons/${K.ignac}/family-root`, { familyRoot: true })).statusCode).toBe(200);
    await moved();
    // A merge: a duplicate of Quido into him.
    await accept([
      { op: 'createPerson', tempId: 'tmp:d', sex: 'male', name: { given: 'Quido', surname: 'Invented', type: 'birth', asFound: 'Quido Duplicatus' } },
      ...citation('D'),
    ]);
    const idOf = async (asFound: string) =>
      (await t.db.selectFrom('name').select('person_id').where('as_found', '=', asFound).executeTakeFirstOrThrow()).person_id;
    const [keep, gone] = await Promise.all(
      [await idOf('Quido Inventus'), await idOf('Quido Duplicatus')].map(async (id) =>
        PersonDetail.parse((await call(editor, 'GET', `/api/persons/${id}`)).json()),
      ),
    );
    await moved();
    const merged = await call(editor, 'POST', `/api/persons/${keep!.id}/merge`, {
      mergeId: gone!.id,
      keepBaseVersion: keep!.version,
      mergeBaseVersion: gone!.version,
      note: null,
    });
    expect(merged.statusCode, merged.body).toBe(200);
    await moved();
    // An erasure: Viktor, Living, at his request; a Member linked to him sees the prompt again ("Own Person erased").
    expect((await call(owner, 'PUT', `/api/members/${unlinked.id}/person`, { personId: K.viktor })).statusCode).toBe(200);
    expect((await kinship(unlinked, K.norbert)).paths[0]!.term.cs.text).toBe('otec');
    const erased = await call(owner, 'POST', `/api/persons/${K.viktor}/erase`, { confirmation: 'Viktor Javorník' });
    expect(erased.statusCode, erased.body).toBe(200);
    await moved();
    expect(Me.parse((await call(unlinked, 'GET', '/api/me')).json()).person).toBeNull();
    expect((await call(unlinked, 'GET', `/api/persons/${K.norbert}/kinship`)).statusCode).toBe(422);
    expect((await call(reader, 'GET', `/api/persons/${K.viktor}/kinship`)).statusCode).toBe(404);
  });

  it('requests that arrive while the Tree changed share one rebuild', async () => {
    await accept([...citation('SHARE')]);
    const [a, b] = await Promise.all([linkCopy(t.db), linkCopy(t.db)]);
    expect(a).toBe(b);
  });
});
