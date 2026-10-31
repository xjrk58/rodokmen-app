import {
  FamilyRootList,
  History,
  Hourglass,
  MapEventsResult,
  Me,
  PersonSearchResult,
  ProposalView,
  relationsOf,
  type FamilyLinkById,
  type OperationInput,
  type Relation,
} from '@rodokmen/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { recomputeRelations } from '../src/tree/relation.js';
import type { TestDatabase } from './db.js';
import { bearer, createAgentWithToken, errorOf } from './helpers.js';
import { citation, useProposalTestbed } from './proposal-testbed.js';

const model = generateFixture();
const L = model.landmarks;

/**
 * The relation each fixture Person should have with these Family roots, worked out from the
 * fixture model itself (not from the database), with the rule of shared/src/relation.ts.
 */
function expectedRelations(roots: string[]): Map<string, Relation> {
  const roleOf = new Map<string, Set<string>>();
  for (const r of model.roles) roleOf.set(`${r.eventId}:${r.personId}`, new Set([...(roleOf.get(`${r.eventId}:${r.personId}`) ?? []), r.role]));
  const confidence = new Map(model.citations.map((c) => [c.id, c.confidence]));
  const citationsOf = (eventId: string) => model.eventCitations.filter((ec) => ec.eventId === eventId).map((ec) => confidence.get(ec.citationId)!);
  const has = (eventId: string, personId: string, roles: string[]) => roles.some((r) => roleOf.get(`${eventId}:${personId}`)?.has(r));
  const evidence = (a: string, aRoles: string[], b: string, bRoles: string[]) =>
    model.events.filter((e) => has(e.id, a, aRoles) && has(e.id, b, bRoles)).flatMap((e) => citationsOf(e.id));
  const links: FamilyLinkById[] = [];
  for (const f of model.families) {
    if (f.partner1Id && f.partner2Id)
      links.push({ a: f.partner1Id, b: f.partner2Id, confidences: evidence(f.partner1Id, ['partner'], f.partner2Id, ['partner']) });
    for (const l of model.childLinks.filter((x) => x.familyId === f.id)) {
      for (const parent of [f.partner1Id, f.partner2Id]) {
        if (parent) links.push({ a: parent, b: l.childId, confidences: evidence(l.childId, ['child'], parent, ['father', 'mother']) });
      }
    }
  }
  return relationsOf(
    model.persons.map((p) => p.id),
    roots,
    links,
  );
}

describe('Family roots and the relation to the family (add-vault-import tasks 1.3 and 1.4)', () => {
  const { ready, call, submit, person } = useProposalTestbed();
  let t: TestDatabase;
  let owner: Account;
  let editor: Account;
  let contributor: Account;
  beforeAll(() => ({ t, owner, editor, contributor } = ready()));

  const relationOf = async (id: string) => (await person(id)).relation;
  const stored = async () => new Map((await t.db.selectFrom('person').select(['id', 'relation']).execute()).map((p) => [p.id, p.relation]));
  const markRoot = (m: Account, id: string, familyRoot = true) => call(m, 'PUT', `/api/persons/${id}/family-root`, { familyRoot });
  const accept = async (operations: OperationInput[]) => {
    const p = ProposalView.parse((await submit(contributor, operations)).json());
    const res = await call(editor, 'POST', `/api/proposals/${p.id}/accept`, {});
    expect(res.statusCode, res.body).toBe(200);
    return p.id;
  };

  it('no Family roots yet: everyone is an Unrelated person, and Me says there is no root', async () => {
    expect(new Set((await stored()).values())).toEqual(new Set(['unrelated']));
    expect(Me.parse((await call(contributor, 'GET', '/api/me')).json()).familyRoots).toEqual([]);
    const hits = PersonSearchResult.parse((await call(contributor, 'GET', '/api/persons?q=novak')).json()).items;
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.person).toMatchObject({ relation: 'unrelated', familyRoot: false });
  });

  it('only the Owner marks Family roots: Editors, Contributors and Agents are refused with 403', async () => {
    for (const m of [editor, contributor]) expect((await markRoot(m, L.founder)).statusCode).toBe(403);
    const { token } = await createAgentWithToken(t.db, ready().a.clock);
    const res = await ready().a.app.inject({
      method: 'PUT',
      url: `/api/persons/${L.founder}/family-root`,
      headers: bearer(token),
      payload: { familyRoot: true },
    });
    expect(res.statusCode).toBe(403);
    // Nor through a Proposal: setFamilyRoot is the server's own operation.
    const sneaky = await call(editor, 'POST', '/api/proposals', {
      formatVersion: 1,
      idempotencyKey: 'family-root-sneak',
      note: null,
      direct: true,
      operations: [{ op: 'setFamilyRoot', personId: L.founder, familyRoot: true }],
    });
    expect(sneaky.statusCode).toBe(403);
    expect(await t.db.selectFrom('family_root').selectAll().execute()).toEqual([]);
  });

  it('first Family roots: the Owner marks the founding couple, and every relation is computed from them', async () => {
    const founding = model.families.find((f) => f.partner1Id === L.founder || f.partner2Id === L.founder)!;
    const wife = founding.partner1Id === L.founder ? founding.partner2Id! : founding.partner1Id!;
    const versionsBefore = new Map((await t.db.selectFrom('person').select(['id', 'version']).execute()).map((p) => [p.id, p.version]));
    const first = await markRoot(owner, L.founder);
    expect(first.statusCode, first.body).toBe(200);
    const res = await markRoot(owner, wife);
    expect(FamilyRootList.parse(res.json()).items.map((p) => [p.id, p.familyRoot])).toEqual([
      [L.founder, true],
      [wife, true],
    ]);
    // Marking again changes nothing.
    expect(FamilyRootList.parse((await markRoot(owner, wife)).json()).items).toHaveLength(2);
    expect(Me.parse((await call(contributor, 'GET', '/api/me')).json()).familyRoots).toEqual([L.founder, wife]);
    expect(FamilyRootList.parse((await call(contributor, 'GET', '/api/family-roots')).json()).items.map((p) => p.id)).toEqual([L.founder, wife]);

    // The stored relations are the rule applied to the fixture's Family links and Citations.
    const expected = expectedRelations([L.founder, wife]);
    const actual = await stored();
    for (const [id, relation] of expected) expect(actual.get(id), id).toBe(relation);
    const counts = [...expected.values()].reduce((m, r) => m.set(r, (m.get(r) ?? 0) + 1), new Map<string, number>());
    expect(counts.get('relative')).toBeGreaterThan(20);
    expect(counts.get('possible')).toBeGreaterThan(0);
    expect(counts.get('unrelated')).toBeGreaterThan(0);
    // A derived relation is no change of a Person: no version moved, so no pending Proposal is in conflict.
    const versionsAfter = new Map((await t.db.selectFrom('person').select(['id', 'version']).execute()).map((p) => [p.id, p.version]));
    expect(versionsAfter).toEqual(versionsBefore);
  });

  it("logged like the Owner's other direct changes: the Person's history shows who marked the Family root and when", async () => {
    const history = History.parse((await call(contributor, 'GET', `/api/history/person/${L.founder}`)).json()).items;
    const entry = history.find((h) => h.summaries.some((s) => s.en.includes('as a Family root')))!;
    expect(entry).toMatchObject({ kind: 'direct', author: { id: owner.id }, acceptedBy: { id: owner.id } });
    expect(entry.summaries[0]!.cs).toMatch(/kořen rodu/);
    expect(entry.changes).toEqual([expect.objectContaining({ table: 'family_root', before: null })]);
  });

  let godfather = '';
  it('godparent from the same village: a Person who appears only as godparent at a family baptism is an Unrelated person', async () => {
    const baptism = await t.db.selectFrom('event').select('version').where('id', '=', L.janBaptism).executeTakeFirstOrThrow();
    await accept([
      { op: 'createPerson', tempId: 'tmp:g', sex: 'male', name: { given: 'Jakub', surname: 'Novák', type: 'birth', asFound: 'Jacobus Nowak Vicinus' } },
      { op: 'addRole', eventId: L.janBaptism, personId: 'tmp:g', role: 'godparent', baseVersion: baptism.version },
      // He also died in the village, an Event of his alone.
      { op: 'createEvent', tempId: 'tmp:d', type: 'death', date: '1850-03-03', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:d', personId: 'tmp:g', role: 'deceased' },
      ...citation('GOD', { confidence: 'very_high' }),
      { op: 'attachCitation', citationId: 'tmp:citGOD', eventId: 'tmp:d' },
    ]);
    godfather = (await t.db.selectFrom('name').select('person_id').where('as_found', '=', 'Jacobus Nowak Vicinus').executeTakeFirstOrThrow()).person_id;
    expect(await relationOf(godfather)).toBe('unrelated');
    expect(await relationOf(L.janNovak)).not.toBe('unrelated');
  });

  /** A Relative with no children in the fixture to hang new Persons on. */
  const relative = async () => {
    const all = PersonSearchResult.parse((await call(contributor, 'GET', '/api/persons?q=novak&relation=relative&limit=200')).json()).items;
    return all.find((h) => h.person.sex === 'male' && !h.person.living)!.person;
  };

  let wifeId = '';
  it('linked through a confirmed marriage: a woman married to a Relative, the marriage Citation of high confidence, is a Relative', async () => {
    const husband = await relative();
    await accept([
      { op: 'createPerson', tempId: 'tmp:w', sex: 'female', name: { given: 'Ludmila', surname: 'Invented', type: 'birth', asFound: 'Ludmilla Inventa' } },
      { op: 'createEvent', tempId: 'tmp:m', type: 'marriage', date: '1841-02-02', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:m', personId: husband.id, role: 'partner' },
      { op: 'addRole', eventId: 'tmp:m', personId: 'tmp:w', role: 'partner' },
      { op: 'createFamily', tempId: 'tmp:f', partner1Id: husband.id, partner2Id: 'tmp:w' },
      ...citation('MAR', { confidence: 'high' }),
      { op: 'attachCitation', citationId: 'tmp:citMAR', eventId: 'tmp:m' },
    ]);
    wifeId = (await t.db.selectFrom('name').select('person_id').where('as_found', '=', 'Ludmilla Inventa').executeTakeFirstOrThrow()).person_id;
    expect(await relationOf(wifeId)).toBe('relative');
  });

  let sonId = '';
  let baptismId = '';
  let improvement = '';
  it('only a weak link: a man linked only through a father link whose single Citation has low confidence is a Possible relative', async () => {
    const father = await relative();
    await accept([
      { op: 'createPerson', tempId: 'tmp:s', sex: 'male', name: { given: 'Prokop', surname: 'Invented', type: 'birth', asFound: 'Procopius Inventus' } },
      { op: 'createEvent', tempId: 'tmp:b', type: 'baptism', date: '1842-05-05', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:b', personId: 'tmp:s', role: 'child' },
      { op: 'addRole', eventId: 'tmp:b', personId: father.id, role: 'father' },
      { op: 'createFamily', tempId: 'tmp:f', partner1Id: father.id, partner2Id: null },
      { op: 'linkChild', familyId: 'tmp:f', childId: 'tmp:s', linkType: 'birth' },
      ...citation('BAP', { confidence: 'low' }),
      { op: 'attachCitation', citationId: 'tmp:citBAP', eventId: 'tmp:b' },
    ]);
    sonId = (await t.db.selectFrom('name').select('person_id').where('as_found', '=', 'Procopius Inventus').executeTakeFirstOrThrow()).person_id;
    baptismId = (await t.db.selectFrom('event_role').select('event_id').where('person_id', '=', sonId).executeTakeFirstOrThrow()).event_id;
    expect(await relationOf(sonId)).toBe('possible');
    // The tree draws his link as weak.
    const tree = Hourglass.parse((await call(contributor, 'GET', `/api/persons/${sonId}/hourglass?up=1&down=1`)).json());
    expect(tree.childLinks.find((l) => l.childId === sonId)).toMatchObject({ weakLink: true });
    const own = Hourglass.parse((await call(contributor, 'GET', `/api/persons/${L.janNovak}/hourglass?up=2&down=1`)).json());
    expect(own.persons.find((p) => p.relation === 'focus')!.person.relation).toBe((await person(L.janNovak)).relation);
  });

  it('evidence improves: the weak father link gets a second Citation of high confidence, and he becomes a Relative once accepted', async () => {
    const event = await t.db.selectFrom('event').select('version').where('id', '=', baptismId).executeTakeFirstOrThrow();
    const p = ProposalView.parse(
      (
        await submit(contributor, [
          ...citation('BAP2', { confidence: 'high' }),
          { op: 'attachCitation', citationId: 'tmp:citBAP2', eventId: baptismId, baseVersion: event.version },
        ])
      ).json(),
    );
    // Pending: nothing changes until an Editor accepts it.
    expect(await relationOf(sonId)).toBe('possible');
    expect((await call(editor, 'POST', `/api/proposals/${p.id}/accept`, {})).statusCode).toBe(200);
    improvement = p.id;
    expect(await relationOf(sonId)).toBe('relative');
    const tree = Hourglass.parse((await call(contributor, 'GET', `/api/persons/${sonId}/hourglass?up=1&down=1`)).json());
    expect(tree.childLinks.find((l) => l.childId === sonId)).toMatchObject({ weakLink: false });
  });

  it('an undo recomputes too: undoing the second Citation makes him a Possible relative again', async () => {
    const res = await call(editor, 'POST', `/api/proposals/${improvement}/undo`, { note: null, choices: [] });
    expect(res.statusCode, res.body).toBe(200);
    expect(await relationOf(sonId)).toBe('possible');
  });

  it("a Citation's confidence corrected to normal makes the link count", async () => {
    const cit = await t.db
      .selectFrom('event_citation as ec')
      .innerJoin('citation as c', 'c.id', 'ec.citation_id')
      .select(['c.id', 'c.version'])
      .where('ec.event_id', '=', baptismId)
      .executeTakeFirstOrThrow();
    await accept([...citation('FIX'), { op: 'setField', record: 'citation', id: cit.id, baseVersion: cit.version, set: { confidence: 'normal' } }]);
    expect(await relationOf(sonId)).toBe('relative');
  });

  it('merging recomputes, and a merged Family root stays one, on the kept Person; undoing the merge puts it back', async () => {
    // A duplicate of the founder, unrelated until merged into him.
    await accept([
      { op: 'createPerson', tempId: 'tmp:d', sex: 'male', name: { given: 'Václav', surname: 'Novák', type: 'birth', asFound: 'Wenceslaus Duplicatus' } },
      ...citation('DUP'),
    ]);
    const dup = (await t.db.selectFrom('name').select('person_id').where('as_found', '=', 'Wenceslaus Duplicatus').executeTakeFirstOrThrow()).person_id;
    expect(await relationOf(dup)).toBe('unrelated');
    // The duplicate is marked as a root and merged into an unrelated Person: the kept one becomes the root.
    expect((await markRoot(owner, dup)).statusCode).toBe(200);
    expect(await relationOf(dup)).toBe('relative');
    const keep = (await person(dup)).version;
    const godparent = godfather;
    const kept = await person(godparent);
    const merged = await call(editor, 'POST', `/api/persons/${godparent}/merge`, {
      mergeId: dup,
      keepBaseVersion: kept.version,
      mergeBaseVersion: keep,
      note: null,
    });
    expect(merged.statusCode, merged.body).toBe(200);
    expect((await person(godparent)).familyRoot).toBe(true);
    expect(await relationOf(godparent)).toBe('relative');
    expect((await t.db.selectFrom('person').select('relation').where('id', '=', dup).executeTakeFirstOrThrow()).relation).toBe('unrelated');
    // An Editor may undo the merge: the root goes back to the duplicate.
    expect((await call(editor, 'POST', `/api/proposals/${ProposalView.parse(merged.json()).id}/undo`, { note: null, choices: [] })).statusCode).toBe(200);
    expect((await person(godparent)).familyRoot).toBe(false);
    expect(await relationOf(godparent)).toBe('unrelated');
    expect((await person(dup)).familyRoot).toBe(true);
    expect((await markRoot(owner, dup, false)).statusCode).toBe(200);
  });

  it("only the Owner undoes a Family root: an Editor's undo is refused, the Owner's recomputes everyone", async () => {
    const history = History.parse((await call(owner, 'GET', `/api/history/person/${L.founder}`)).json()).items;
    const marking = history.find((h) => h.summaries.some((s) => s.en.includes('marks')))!;
    const refused = await call(editor, 'POST', `/api/proposals/${marking.proposalId}/undo`, { note: null, choices: [] });
    expect(refused.statusCode).toBe(403);
    expect(errorOf(refused).message).toMatch(/Owner/);
    expect((await call(owner, 'POST', `/api/proposals/${marking.proposalId}/undo`, { note: null, choices: [] })).statusCode).toBe(200);
    expect((await person(L.founder)).familyRoot).toBe(false);
    // The founder's wife is still a root, so the line stays related through her.
    expect(await relationOf(L.founder)).toBe('relative');
    expect((await markRoot(owner, L.founder)).statusCode).toBe(200);
  });

  it('family only: searching "novák" with the filter Relatives and Possible relatives finds no Unrelated person', async () => {
    const all = PersonSearchResult.parse((await call(contributor, 'GET', '/api/persons?q=nov%C3%A1k&limit=200')).json()).items;
    expect(all.some((h) => h.person.relation === 'unrelated')).toBe(true);
    const family = PersonSearchResult.parse((await call(contributor, 'GET', '/api/persons?q=nov%C3%A1k&relation=relative,possible&limit=200')).json()).items;
    expect(family.length).toBeGreaterThan(0);
    expect(family.every((h) => h.person.relation !== 'unrelated')).toBe(true);
    expect(family.length).toBe(all.filter((h) => h.person.relation !== 'unrelated').length);
    const unrelated = PersonSearchResult.parse((await call(contributor, 'GET', '/api/persons?q=nov%C3%A1k&relation=unrelated&limit=200')).json()).items;
    expect(unrelated.length + family.length).toBe(all.length);
    expect((await call(contributor, 'GET', '/api/persons?relation=cousins')).statusCode).toBe(400);
  });

  it('everyone in a village: map Events without a filter include those of Unrelated people, each Person marked with their relation', async () => {
    const { token } = await createAgentWithToken(t.db, ready().a.clock, 'Village Agent');
    const get = async (filter: string) =>
      MapEventsResult.parse(
        (
          await ready().a.app.inject({ method: 'GET', url: `/api/map/events?bbox=15.89,49.92,15.93,49.94&from=1600&to=1950${filter}`, headers: bearer(token) })
        ).json(),
      ).events;
    const everyone = await get('');
    const persons = everyone.flatMap((e) => e.persons);
    expect(persons.some((p) => p.relation === 'unrelated')).toBe(true);
    expect(persons.some((p) => p.relation === 'relative')).toBe(true);
    const family = await get('&relation=relative,possible');
    expect(family.length).toBeLessThan(everyone.length);
    for (const e of family) expect(e.persons.some((p) => p.relation !== 'unrelated')).toBe(true);
  });

  it('recomputing again changes nothing: the stored relation is what the rule says', async () => {
    expect(await t.db.transaction().execute((tx) => recomputeRelations(tx))).toEqual({ changed: 0 });
  });
});
