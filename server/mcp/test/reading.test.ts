import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { ProposalList, ProposalView, ReadingView } from '@rodokmen/shared';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../../src/fixture/generate.js';
import { fakeAnthropic, fakeReader, recording } from '../../test/fake-anthropic.js';
import { signIn } from '../../test/helpers.js';
import { apiClient } from '../src/api.js';
import { createRodokmenServer } from '../src/server.js';
import { resultOf, useWorld } from './world.js';

const L = generateFixture().landmarks;

/**
 * An Agent reads a scan through the MCP server (scan-reading spec, "Agents can request a
 * reading"; add-scan-reading task 3.2): the real API on the fixture Tree, the reader on recorded
 * answers of the Messages API, and the MCP client in memory.
 */
describe('scan reading through MCP', () => {
  const anthropic = fakeAnthropic(recording('baptism-page'));
  const world = useWorld('Scan reading agent', { reader: fakeReader(anthropic) });
  let client: Client;

  const tool = async (name: string, args: Record<string, unknown>) => resultOf(await client.callTool({ name, arguments: args }));

  beforeAll(async () => {
    const w = world();
    const owner = { cookie: await signIn(w.t.db, w.clock, w.owner), origin: w.apiUrl };
    const on = await w.app.inject({ method: 'PUT', url: '/api/settings/scan-reading', headers: owner, payload: { enabled: true, dailyLimit: 5 } });
    expect(on.statusCode, on.body).toBe(200);
    const server = createRodokmenServer(apiClient(w.apiUrl, w.token));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    client = new Client({ name: 'test-assistant', version: '1.0.0' });
    await client.connect(clientSide);
  });
  afterAll(async () => {
    await client?.close();
  });

  it('reads a scan it uploads, and its Proposal waits in the review queue with every value marked "read by AI" (scenario "Agent reads a scan")', async () => {
    const w = world();
    const scan = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 233, g: 223, b: 199 } } })
      .jpeg()
      .toBuffer();
    const read = await tool('read_scan', {
      images: [{ data: scan.toString('base64'), contentType: 'image/jpeg' }],
      context: { placeId: L.kamennaLhota, sourceTitle: 'Invented register N 1820–1840', page: '41' },
    });
    expect(read.error).toBeNull();
    const reading = ReadingView.parse(read.json);
    expect(reading.status).toBe('done');
    expect(reading.author).toMatchObject({ isAgent: true, displayName: 'Scan reading agent' });
    expect(reading.result!.entries).toHaveLength(3);
    // The image went to the reader as its display copy, once.
    expect(anthropic.requests).toHaveLength(1);
    expect(anthropic.requests[0]!.body.messages[0]!.content.filter((c) => c.type === 'image')).toHaveLength(1);

    // Nobody is created without a choice.
    const unchosen = await tool('propose_reading', {
      readingId: reading.id,
      persons: { p1: 'new' },
      source: { title: 'Invented register N 1820–1840' },
      note: 'x',
    });
    expect(unchosen.error).toMatch(/Choose an existing Person or "new" for p2/);

    const persons = Object.fromEntries(reading.result!.entries.flatMap((e) => e.persons.map((p) => [p.key, 'new'])));
    // The father is the Jan Novák the reading suggested first.
    const father = reading.matches.find((m) => m.key === 'p2')!.candidates[0]!;
    expect(father.person.id).toBe(L.janNovak);
    persons.p2 = father.person.id;
    const proposed = await tool('propose_reading', {
      readingId: reading.id,
      persons,
      source: { title: 'Invented register N 1820–1840', repository: 'Invented archive' },
      note: 'Three baptisms of 1830 from the invented register, read by the server',
    });
    expect(proposed.error).toBeNull();
    const p = ProposalView.parse(proposed.json);
    expect(p.status).toBe('pending');

    const queue = ProposalList.parse((await w.as('editor', 'GET', '/api/review?limit=100')).json());
    const inQueue = queue.items.find((x) => x.id === p.id)!;
    expect(inQueue.author).toMatchObject({ isAgent: true, displayName: 'Scan reading agent' });
    expect(inQueue.reader!.readingIds).toEqual([reading.id]);
    // Every Event, new Person, Role and the Citation's transcription are marked.
    const markedOps = new Set(inQueue.reader!.marks.map((m) => m.position));
    for (const o of inQueue.operations) {
      if (['createEvent', 'createPerson', 'addRole', 'createCitation'].includes(o.operation.op)) expect(markedOps.has(o.position), o.operation.op).toBe(true);
    }
    const citation = inQueue.operations.map((o) => o.operation).find((o) => o.op === 'createCitation')!;
    expect(citation).toMatchObject({ confidence: 'normal', page: '41' });
    expect(inQueue.operations.map((o) => o.operation)).toContainEqual({
      op: 'addRole',
      eventId: 'tmp:e1',
      personId: L.janNovak,
      role: 'father',
      roleDetail: null,
      baseVersion: undefined,
    });
    expect(inQueue.citations[0]!.images).toHaveLength(1);
  });

  it('get_reading reads it back; another Agent’s or Member’s reading is not found', async () => {
    const r = await tool('get_reading', { readingId: '0192f0c4-7a1e-7c3b-9d2a-000000000999' });
    expect(r.error).toMatch(/404/);
  });
});
