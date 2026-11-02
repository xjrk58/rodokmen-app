import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import {
  CitationDetail,
  LeadDetail,
  LeadList,
  EstateDetail,
  EventDetail,
  FamilyDetail,
  HouseDetail,
  ParishDetail,
  Pedigree,
  PersonDetail,
  PersonSearchResult,
  PlaceDetail,
  PlaceSearchResult,
  ProposalList,
  ProposalView,
  SourceDetail,
  SourceSearchResult,
} from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../../src/fixture/generate.js';
import { apiClient } from '../src/api.js';
import { createRodokmenServer } from '../src/server.js';
import { resultOf, useWorld } from './world.js';

const L = generateFixture().landmarks;

/**
 * Each MCP tool against the fixture Tree (agent-access spec, "MCP server"). The server calls the
 * real API over HTTP with the Agent's token; the client talks to it in memory.
 */
describe('MCP tools on the fixture Tree', () => {
  const world = useWorld();
  let client: Client;

  const tool = async (name: string, args: Record<string, unknown> = {}) => resultOf(await client.callTool({ name, arguments: args }));
  const json = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await tool(name, args);
    expect(r.error, `${name} failed`).toBeNull();
    return r.json;
  };

  beforeAll(async () => {
    const w = world();
    const server = createRodokmenServer(apiClient(w.apiUrl, w.token));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    client = new Client({ name: 'test-assistant', version: '1.0.0' });
    await client.connect(clientSide);
  });
  afterAll(async () => {
    await client?.close();
  });

  it('offers reading, proposing and writing Research leads only: no tool accepts, rejects, merges, undoes, edits the Tree directly or decides on a suggested lead', async () => {
    const { tools } = await client.listTools();
    const WRITES = ['add_search_record', 'close_lead', 'create_lead', 'submit_proposal', 'update_lead'];
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_search_record',
      'close_lead',
      'create_lead',
      'get_ancestors',
      'get_descendants',
      'get_record',
      'list_leads',
      'list_my_proposals',
      'search_persons',
      'search_places',
      'search_sources',
      'submit_proposal',
      'update_lead',
    ]);
    const submit = tools.find((t) => t.name === 'submit_proposal')!;
    expect(JSON.stringify(submit.inputSchema)).not.toContain('direct');
    for (const t of tools.filter((x) => !WRITES.includes(x.name))) expect(t.annotations?.readOnlyHint, t.name).toBe(true);
    for (const t of tools.filter((x) => WRITES.includes(x.name))) expect(t.annotations?.destructiveHint, t.name).toBe(false);
  });

  it('search_persons finds Jan Novák by a Name as found, without diacritics, and narrows by Place and years', async () => {
    const hits = PersonSearchResult.parse(await json('search_persons', { q: 'Joannes Nowak' })).items;
    expect(hits.map((h) => h.person.id)).toContain(L.janNovak);
    const narrowed = PersonSearchResult.parse(await json('search_persons', { q: 'novak', placeId: L.kamennaLhota, from: 1800, to: 1802, limit: 5 }));
    expect(narrowed.items.map((h) => h.person.id)).toContain(L.janNovak);
    expect(narrowed.limit).toBe(5);
  });

  it("search_persons states each result's relation to the family, and filters by it", async () => {
    const all = PersonSearchResult.parse(await json('search_persons', { q: 'novak', limit: 200 })).items;
    expect(all.length).toBeGreaterThan(0);
    for (const h of all) expect(['relative', 'possible', 'unrelated']).toContain(h.person.relation);
    // No Family root in the fixture: everyone is unrelated, so asking for the family finds nobody.
    expect(PersonSearchResult.parse(await json('search_persons', { q: 'novak', relation: ['relative', 'possible'] })).items).toEqual([]);
    expect(PersonSearchResult.parse(await json('search_persons', { q: 'novak', relation: ['unrelated'], limit: 200 })).items).toHaveLength(all.length);
  });

  it('search_places finds a Place by its Czech, German or Latin name', async () => {
    for (const q of ['Kamenná Lhota', 'kamenna']) {
      expect(
        PlaceSearchResult.parse(await json('search_places', { q })).items.map((p) => p.id),
        q,
      ).toContain(L.kamennaLhota);
    }
  });

  it('search_sources finds a Source to cite again', async () => {
    const source = SourceDetail.parse(await json('get_record', { kind: 'source', id: L.familyAccountSource }));
    const hits = SourceSearchResult.parse(await json('search_sources', { q: source.title.slice(0, 12) })).items;
    expect(hits.map((s) => s.id)).toContain(L.familyAccountSource);
  });

  it('get_record reads every kind of record', async () => {
    const jan = PersonDetail.parse(await json('get_record', { kind: 'person', id: L.janNovak }));
    expect(jan.names.map((n) => n.asFound)).toContain('Joannes Nowak');
    expect(FamilyDetail.parse(await json('get_record', { kind: 'family', id: L.janFirstFamily })).id).toBe(L.janFirstFamily);
    const baptism = EventDetail.parse(await json('get_record', { kind: 'event', id: L.janBaptism }));
    expect(baptism.type).toBe('baptism');
    expect(PlaceDetail.parse(await json('get_record', { kind: 'place', id: L.kamennaLhota })).id).toBe(L.kamennaLhota);
    expect(HouseDetail.parse(await json('get_record', { kind: 'house', id: L.houseA })).id).toBe(L.houseA);
    expect(ParishDetail.parse(await json('get_record', { kind: 'parish', id: L.parishDolniKamenec })).id).toBe(L.parishDolniKamenec);
    expect(EstateDetail.parse(await json('get_record', { kind: 'estate', id: L.estateVrbice })).id).toBe(L.estateVrbice);
    const citationId = baptism.citations[0]!.id;
    expect(CitationDetail.parse(await json('get_record', { kind: 'citation', id: citationId })).transcription.length).toBeGreaterThan(0);
  });

  it('get_record says so when there is no such record', async () => {
    const r = await tool('get_record', { kind: 'person', id: '0192f0c4-7a1e-7c3b-9d2a-00000000beef' });
    expect(r.error).toBe('The API refused the request (404 not_found): No Person with this id.');
  });

  it('get_ancestors and get_descendants read the family tree both ways', async () => {
    const up = Pedigree.parse(await json('get_ancestors', { personId: L.proband, generations: 6 }));
    expect(up.direction).toBe('ancestors');
    expect(up.persons.find((p) => p.person.id === L.founder)?.generation).toBe(6);
    const down = Pedigree.parse(await json('get_descendants', { personId: L.founder, generations: 6 }));
    expect(down.persons.map((p) => p.person.id)).toContain(L.proband);
    expect(Pedigree.parse(await json('get_ancestors', { personId: L.proband, generations: 2 })).generations).toBe(2);
  });

  it('assistant submits a finding: a baptism Proposal with its Citation appears in the review queue labelled with the Agent’s name', async () => {
    const w = world();
    const submitted = ProposalView.parse(
      await json('submit_proposal', {
        note: 'Baptism of Kristina, register of Kamenná Lhota, page 52',
        operations: [
          { op: 'createPerson', tempId: 'tmp:p', sex: 'female', name: { given: 'Kristina', surname: 'Invented', type: 'birth', asFound: 'Christina' } },
          { op: 'createEvent', tempId: 'tmp:e', type: 'baptism', date: '1846-01-11', placeId: L.kamennaLhota },
          { op: 'addRole', eventId: 'tmp:e', personId: 'tmp:p', role: 'child' },
          { op: 'addRole', eventId: 'tmp:e', personId: L.janNovak, role: 'godparent' },
          {
            op: 'createCitation',
            tempId: 'tmp:c',
            sourceId: L.familyAccountSource,
            page: '52',
            transcription: 'Christina, filia legitima',
            readOn: '2026-10-30',
            confidence: 'normal',
          },
          { op: 'attachCitation', citationId: 'tmp:c', eventId: 'tmp:e' },
        ],
      }),
    );
    expect(submitted).toMatchObject({ status: 'pending', author: { id: w.agent.id, displayName: 'Register reader', isAgent: true } });

    const queue = ProposalList.parse((await w.as('editor', 'GET', '/api/review')).json()).items;
    const listed = queue.find((p) => p.id === submitted.id)!;
    expect(listed.author).toEqual({ id: w.agent.id, displayName: 'Register reader', isAgent: true });
    expect(listed.citations.map((c) => c.page)).toEqual(['52']);

    const mine = ProposalList.parse(await json('list_my_proposals', { status: 'pending' })).items;
    expect(mine.map((p) => p.id)).toContain(submitted.id);
  });

  it('a retried submit with the same key gives the same Proposal', async () => {
    const args = {
      note: 'A second Latin form of a Name',
      idempotencyKey: 'mcp-test-retry-0001',
      operations: [
        { op: 'createSource', tempId: 'tmp:s', type: 'parish_register', title: 'Invented register R', repository: 'Invented archive' },
        { op: 'createCitation', tempId: 'tmp:c', sourceId: 'tmp:s', page: '3', transcription: 'Laurentius', readOn: '2026-10-30', confidence: 'low' },
      ],
    };
    const first = ProposalView.parse(await json('submit_proposal', args));
    const again = ProposalView.parse(await json('submit_proposal', args));
    expect(again.id).toBe(first.id);
  });

  it('a Proposal without evidence is refused with the reason, and nothing is stored', async () => {
    const w = world();
    const before = await w.t.db.selectFrom('proposal').select('id').where('author_id', '=', w.agent.id).execute();
    const r = await tool('submit_proposal', {
      note: 'No Citation',
      operations: [{ op: 'createPerson', tempId: 'tmp:p', sex: 'male', name: { given: 'Nikdo', surname: 'Invented', type: 'birth', asFound: 'Nikdo' } }],
    });
    expect(r.error).toMatch(/^The API refused the request \(400 evidence_missing\)/);
    expect(await w.t.db.selectFrom('proposal').select('id').where('author_id', '=', w.agent.id).execute()).toEqual(before);
  });

  it('arguments outside the tool’s schema are refused before any API call', async () => {
    const r = await tool('get_record', { kind: 'proposal', id: 'x' });
    expect(r.error).toMatch(/Input validation error/);
  });

  describe('Research leads', () => {
    let register: string;
    beforeAll(async () => {
      register = SourceSearchResult.parse(await json('search_sources', { q: 'narozených', type: 'parish_register' })).items[0]!.id;
    });

    it('agent records a negative search: it closes the lead as not found with a search record, and the lead shows the Agent as author', async () => {
      const w = world();
      const lead = LeadDetail.parse(
        await json('create_lead', {
          question: 'Find the baptism of Kristina',
          reason: 'Godmother in 1846; her age is not given.',
          sourceId: register,
          personIds: [L.janNovak],
        }),
      );
      expect(lead).toMatchObject({ status: 'open', author: { id: w.agent.id, displayName: 'Register reader', isAgent: true } });
      // Not found without a search record is refused, with the reason.
      const refused = await tool('close_lead', { leadId: lead.id, baseVersion: lead.version, status: 'not_found' });
      expect(refused.error).toMatch(/^The API refused the request \(400 search_needed\): A lead closes as not found only with a search record/);
      const closed = LeadDetail.parse(
        await json('close_lead', {
          leadId: lead.id,
          baseVersion: lead.version,
          status: 'not_found',
          outcome: 'No Kristina in those years.',
          search: { sourceId: register, years: { from: 1820, to: 1830 }, pages: '1–60', found: false },
        }),
      );
      expect(closed).toMatchObject({ status: 'not_found', author: { isAgent: true } });
      expect(closed.searches).toMatchObject([
        { source: { id: register }, years: { from: 1820, to: 1830 }, pages: '1–60', found: false, searchedBy: 'Register reader' },
      ]);
      // A Member sees the search too.
      const seen = LeadDetail.parse((await w.as('editor', 'GET', `/api/leads/${lead.id}`)).json());
      expect(seen.searches[0]!.author).toEqual({ id: w.agent.id, displayName: 'Register reader', isAgent: true });
    });

    it('lists, reads, updates leads and records searches', async () => {
      const lead = LeadDetail.parse(
        await json('create_lead', { question: 'Find the marriage of Jan', reason: 'Children from 1826.', placeIds: [L.kamennaLhota] }),
      );
      const listed = LeadList.parse(await json('list_leads', { placeId: L.kamennaLhota, status: ['open', 'in_progress'] }));
      expect(listed.items.map((l) => l.id)).toContain(lead.id);
      const updated = LeadDetail.parse(await json('update_lead', { leadId: lead.id, baseVersion: lead.version, status: 'in_progress', pages: '10–40' }));
      expect(updated).toMatchObject({ status: 'in_progress', pages: '10–40' });
      const stale = await tool('update_lead', { leadId: lead.id, baseVersion: lead.version, pages: '1–5' });
      expect(stale.error).toMatch(/409 conflict/);
      const searched = LeadDetail.parse(
        await json('add_search_record', { leadId: lead.id, search: { archive: 'Invented archive', years: { from: 1824, to: 1826 }, found: false } }),
      );
      expect(searched.searches).toHaveLength(1);
      expect(LeadDetail.parse(await json('get_record', { kind: 'lead', id: lead.id })).history.map((h) => h.kind)).toEqual(['searched', 'edited', 'created']);
    });

    it('a Proposal names the lead it answers', async () => {
      const lead = LeadDetail.parse(await json('create_lead', { question: 'Find the godparent', reason: 'Named in a later entry.' }));
      const p = ProposalView.parse(
        await json('submit_proposal', {
          note: 'Godparent found',
          answersLeads: [lead.id],
          operations: [
            { op: 'createSource', tempId: 'tmp:s', type: 'parish_register', title: 'Invented register G', repository: 'Invented archive' },
            { op: 'createCitation', tempId: 'tmp:c', sourceId: 'tmp:s', page: '9', transcription: 'Patrinus', readOn: '2026-10-30', confidence: 'normal' },
          ],
        }),
      );
      expect(p.answersLeads).toEqual([{ id: lead.id, question: 'Find the godparent', status: 'open' }]);
    });
  });
});
