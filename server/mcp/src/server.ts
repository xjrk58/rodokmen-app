import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import {
  Operation,
  OPERATIONS_VERSION,
  ProposalStatus,
  ReadingContext,
  ReadingCrop,
  ReadingView,
  readingOperations,
  RELATIONS,
  unchosenPersons,
} from '@rodokmen/shared';
import { z } from 'zod';
import { ApiCallError, type Api } from './api.js';
import { registerLeadTools } from './lead-tools.js';
import { call, Id, Paging, readOnly } from './tool-parts.js';

/**
 * The Rodokmen MCP server (agent-access spec, "MCP server" and "Agents write Research leads"): an
 * assistant with an Agent token searches Persons, Places and Sources, reads records and family
 * trees, submits Proposals and follows its own Proposals, and lists, writes, updates and closes
 * Research leads with their search records. Every tool is one call to the public API with the
 * Agent's token, so the server offers nothing the token may not do there: no accepting,
 * rejecting, merging, undoing, direct edits or deciding on suggested leads.
 */
export const SERVER_INFO = { name: 'rodokmen', version: '0.1.0' };

const INSTRUCTIONS = `Rodokmen is a private family tree of the Czech lands. You act as an Agent: you may read the Tree and submit Proposals, nothing else.
A Proposal bundles everything one finding changes (for example a baptism entry: the child, the Event, the Roles, and the Citation of the register page), and needs at least one Citation as evidence. Editors review every Proposal; it changes the Tree only when accepted.
Search before you propose, and refer to existing Persons, Places and Sources by id instead of creating duplicates. Only Editors merge records: when you find a Person or an Event in the Tree twice, say so in a Research lead instead of proposing it again. Dates are EDTF (1801-03-12, 1801~, 1801/1803). A Name has a type (birth, married, nickname or other) and, apart, the language it is written in as a BCP 47 tag (cs, la, de, pl …), or null when not known: a Latin form from a register is type other with language la.
Research leads are the family's plans: a question, where to look and what came of it. They state no fact, so you write them directly, without review. Before searching a register, list the leads of the Person or Place: a search record shows what was already looked at. Record every search you make, including one that found nothing; a lead closes as not found only with a search record. A Proposal may name the leads it answers (answersLeads): accepting it marks them found.
To say how two Persons are related, get_kinship works it out from the Family links; you have no own Person, so name both.
Your Agent is limited to 60 Proposals and 1,000 other requests per hour; a refused request says when to try again.
When the Owner has switched scan reading on, read_scan has the server read register scans (sent to Anthropic's API) into entries; check them, choose for every read person an existing Person or "new", and propose_reading submits them, marked "read by AI".`;

/** Records that can be read by id, and the API route of each. */
const RECORD_KINDS = ['person', 'family', 'event', 'place', 'house', 'parish', 'estate', 'source', 'citation', 'lead'] as const;
const RECORDS: Record<(typeof RECORD_KINDS)[number], string> = {
  person: 'persons',
  family: 'families',
  event: 'events',
  place: 'places',
  house: 'houses',
  parish: 'parishes',
  estate: 'estates',
  source: 'sources',
  citation: 'citations',
  lead: 'leads',
};

/** How long read_scan waits for a reading, and how often it looks. */
export const READING_WAIT_MS = 5 * 60_000;
export const READING_POLL_MS = 2_000;

/** The reading once it is done or failed; still queued or running after READING_WAIT_MS, as it is then. */
async function waitForReading(api: Api, id: string, waitMs = READING_WAIT_MS, pollMs = READING_POLL_MS): Promise<unknown> {
  const until = Date.now() + waitMs;
  for (;;) {
    const view = ReadingView.parse(await api.get(`/api/readings/${id}`));
    if (view.status === 'done' || view.status === 'failed' || Date.now() >= until) return view;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export function createRodokmenServer(api: Api): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  server.registerTool(
    'search_persons',
    {
      title: 'Search Persons',
      description:
        'Search Persons in the Tree by any part of any of their Names (case and diacritics are ignored), optionally only those with an Event at a Place, in a range of years, or with a relation to the family. Each result states its relation: relative, possible (a Possible relative, linked only through a weakly supported link) or unrelated.',
      inputSchema: z.object({
        q: z.string().min(1).max(200).optional().describe('Any part of any Name, such as "Novák" or "Jan Novak"'),
        placeId: Id.optional().describe('Only Persons with an Event at this Place or one of its Houses'),
        from: z.number().int().min(1).max(9999).optional().describe('Only Persons with an Event that could be in or after this year'),
        to: z.number().int().min(1).max(9999).optional().describe('Only Persons with an Event that could be in or before this year'),
        relation: z
          .array(z.enum(RELATIONS))
          .min(1)
          .optional()
          .describe('Only Persons with these relations to the family, such as ["relative", "possible"]; without it, everyone'),
        ...Paging,
      }),
      annotations: readOnly,
    },
    async ({ relation, ...args }) => call(() => api.get('/api/persons', { ...args, ...(relation ? { relation: [...new Set(relation)].join(',') } : {}) })),
  );

  server.registerTool(
    'search_places',
    {
      title: 'Search Places',
      description: 'Search Places (villages, towns, hamlets) by any of their names over time, in Czech, German or Latin.',
      inputSchema: z.object({ q: z.string().min(1).max(200).optional().describe('Any part of any name of the Place'), ...Paging }),
      annotations: readOnly,
    },
    async (args) => call(() => api.get('/api/places', args)),
  );

  server.registerTool(
    'search_sources',
    {
      title: 'Search Sources',
      description:
        'Search Sources (parish registers, census sheets, land books, Family accounts) by title, so a Proposal can cite an existing Source instead of creating it again.',
      inputSchema: z.object({
        q: z.string().min(1).max(200).optional().describe('Any part of the title'),
        type: z.string().max(40).optional().describe('Only Sources of this type, such as parish_register'),
        ...Paging,
      }),
      annotations: readOnly,
    },
    async (args) => call(() => api.get('/api/sources', args)),
  );

  server.registerTool(
    'get_record',
    {
      title: 'Read a record',
      description:
        'Read one record by id: a Person (Names, Events, Families), Family, Event (Roles, Citations), Place, House, Parish, Estate, Source (with the Parish, kinds and years of a register) or Citation (transcription) of the Tree, or a Research lead with its search records and history. A Person or an Event merged into another is answered with the kept one.',
      inputSchema: z.object({ kind: z.enum(RECORD_KINDS).describe('What kind of record the id is'), id: Id }),
      annotations: readOnly,
    },
    async ({ kind, id }) => call(() => api.get(`/api/${RECORDS[kind]}/${id}`)),
  );

  const Pedigree = z.object({
    personId: Id.describe('The Person the chart starts from'),
    generations: z.number().int().min(1).max(12).optional().describe('Generations in the chart, the Person counting as the first (default 6)'),
  });

  server.registerTool(
    'get_ancestors',
    {
      title: 'Read ancestors',
      description: "A Person's known ancestors up to a number of generations, with the Families linking them.",
      inputSchema: Pedigree,
      annotations: readOnly,
    },
    async ({ personId, generations }) => call(() => api.get(`/api/persons/${personId}/ancestors`, { generations })),
  );

  server.registerTool(
    'get_descendants',
    {
      title: 'Read descendants',
      description: "A Person's known descendants up to a number of generations, with their partners and the Families linking them.",
      inputSchema: Pedigree,
      annotations: readOnly,
    },
    async ({ personId, generations }) => call(() => api.get(`/api/persons/${personId}/descendants`, { generations })),
  );

  server.registerTool(
    'get_chart',
    {
      title: 'Read a Chart',
      description:
        "A Chart's content as data, as the app gets it (no picture): a Descendant chart from a Person or a Family (who is in it, in the Chart's order, with each card's facts and marks, and the Direct line to a descendant), or a House chart (the Families who lived at a House, in time order, with their periods, house numbers and how each is linked to an earlier row). Living people are shown as in the tree.",
      inputSchema: z.object({
        kind: z.enum(['descendants', 'house']).describe('descendants: from a Person or a Family; house: the Families of a House'),
        personId: Id.optional().describe('descendants: start at this Person'),
        familyId: Id.optional().describe('descendants: start at this Family'),
        houseId: Id.optional().describe('house: the House'),
        generations: z
          .number()
          .int()
          .min(2)
          .max(8)
          .optional()
          .describe('descendants: generations in the tree form, the start counting as the first (default 4)'),
        form: z.enum(['tree', 'line']).optional().describe('descendants: tree (every branch) or line (the Direct line down the centre)'),
        line: Id.optional().describe('descendants: the end of the Direct line, a descendant of the start; needed for the line form'),
        from: z.number().int().optional().describe('house: only rows whose period could reach this year or later'),
        to: z.number().int().optional().describe('house: only rows whose period could reach this year or earlier'),
        unrelated: z.boolean().optional().describe('house: also the rows of Unrelated people'),
      }),
      annotations: readOnly,
    },
    async ({ kind, personId, familyId, houseId, generations, form, line, from, to, unrelated }) =>
      call(() =>
        kind === 'house'
          ? api.get(`/api/charts/house/${houseId ?? ''}`, { from, to, unrelated: unrelated === undefined ? undefined : String(unrelated) })
          : api.get('/api/charts/descendants', { person: personId, family: familyId, generations, form, line }),
      ),
  );

  server.registerTool(
    'get_kinship',
    {
      title: 'How two Persons are related',
      description:
        'How the second Person is related to the first, worked out from the Family links by fixed rules: every path between them, the closest first, each with its common ancestors, every Person on the way, the line and degree as the Czech civil code counts them, whether it is half, through adoption or only possible (a link without a confirming Citation), and the kinship term in Czech and English. Name both Persons.',
      inputSchema: z.object({
        fromPersonId: Id.describe('The Person the kinship is relative to'),
        toPersonId: Id.describe('The Person whose kinship to the first you want'),
      }),
      annotations: readOnly,
    },
    async ({ fromPersonId, toPersonId }) => call(() => api.get(`/api/persons/${toPersonId}/kinship`, { from: fromPersonId })),
  );

  server.registerTool(
    'submit_proposal',
    {
      title: 'Submit a Proposal',
      description:
        'Submit one finding as a Proposal for review: every change it implies, together with at least one Citation (createCitation or attachCitation). New records get temporary ids ("tmp:…") that later operations of the same Proposal refer to; changes to existing records name the version you read. Nothing changes in the Tree until an Editor accepts it. Retrying with the same idempotencyKey returns the same Proposal.',
      inputSchema: z.object({
        note: z.string().min(1).max(4000).describe('What the finding is and where it was found, for the reviewing Editor'),
        operations: z.array(Operation).min(1).max(300).describe('The changes, in order'),
        answersLeads: z.array(Id).max(20).optional().describe('The Research leads this finding answers: accepting the Proposal marks them found'),
        idempotencyKey: z
          .string()
          .regex(/^[A-Za-z0-9_-]{8,100}$/)
          .optional()
          .describe('One key per finding, so a retried submit cannot create it twice; made up when left out'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ note, operations, answersLeads, idempotencyKey }) =>
      call(() =>
        api.post('/api/proposals', {
          formatVersion: OPERATIONS_VERSION,
          idempotencyKey: idempotencyKey ?? `mcp-${randomUUID()}`,
          note,
          operations,
          answersLeads,
        }),
      ),
  );

  server.registerTool(
    'read_scan',
    {
      title: 'Read a register scan',
      description:
        'Have the server read scans of register pages into entries (scan reading: only while the Owner has switched it on, and within a daily limit). Give the images (base64) or the upload ids of scans already uploaded, and what you know of them. The scans, or the crops you mark, are sent to Anthropic’s API; archive viewer links are never fetched: download the image and give it here. Waits for the reading (a few minutes at most) and answers with the transcription, the entries with their persons, the existing Persons each read name may be (with the reasons) and suggested Research leads. Then call propose_reading.',
      inputSchema: z.object({
        images: z
          .array(
            z.object({
              data: z.string().min(1).describe('The image file, base64'),
              contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
            }),
          )
          .max(5)
          .optional()
          .describe('Scans to upload and read, in page order'),
        uploadIds: z.array(Id).max(5).optional().describe('Scans already uploaded, in page order (after the images)'),
        crops: z.array(ReadingCrop).max(5).optional().describe('Parts to read instead of whole scans, by upload id'),
        context: ReadingContext.partial().optional().describe('What you know: the register Source, page, Place, years, a note, the viewer link'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ images, uploadIds, crops, context }) =>
      call(async () => {
        const uploaded: string[] = [];
        for (const image of images ?? []) uploaded.push(await api.upload(Buffer.from(image.data, 'base64'), image.contentType));
        const ids = [...uploaded, ...(uploadIds ?? [])];
        if (ids.length === 0) throw new ApiCallError(400, 'no_scan', 'Give at least one image or upload id to read.');
        const asked = ReadingView.parse(await api.post('/api/readings', { uploadIds: ids, crops: crops ?? [], context: context ?? {} }));
        return waitForReading(api, asked.id);
      }),
  );

  server.registerTool(
    'get_reading',
    {
      title: 'Read a reading',
      description:
        'A scan reading by id, as read_scan answers it: queued, running, failed (with why) or done with its entries, match candidates and suggested leads.',
      inputSchema: z.object({ readingId: Id }),
      annotations: readOnly,
    },
    async ({ readingId }) => call(() => api.get(`/api/readings/${readingId}`)),
  );

  server.registerTool(
    'propose_reading',
    {
      title: 'Propose what a reading found',
      description:
        'Submit a finished reading as a Proposal for review: for every read person (by key: p1, p2, …) give the id of the existing Person it is, or "new" to create one; nobody is created without your choice. The Proposal adds the Events with their Roles, the new Persons and Families, and one Citation per page with its image. Every value stays marked "read by AI", and the Citations have at most normal confidence. Leave out entries you could not check with skipEntries.',
      inputSchema: z.object({
        readingId: Id,
        persons: z.record(z.string(), z.union([Id, z.literal('new')])).describe('For each read person key: an existing Person id, or "new"'),
        source: z
          .union([
            z.object({ sourceId: Id.describe('An existing Source (search_sources)') }),
            z.object({
              title: z.string().min(1).max(400),
              repository: z.string().max(400).optional(),
              reference: z.string().max(200).optional(),
            }),
          ])
          .describe('The register: an existing Source, or a new one'),
        page: z.string().max(200).optional().describe('Page or frame; the reading’s own when left out'),
        skipEntries: z.array(z.number().int().min(0)).max(30).optional().describe('Indexes of entries to leave out'),
        note: z.string().min(1).max(4000).describe('What the finding is, for the reviewing Editor'),
        idempotencyKey: z
          .string()
          .regex(/^[A-Za-z0-9_-]{8,100}$/)
          .optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ readingId, persons, source, page, skipEntries, note, idempotencyKey }) =>
      call(async () => {
        const reading = ReadingView.parse(await api.get(`/api/readings/${readingId}`));
        if (reading.status !== 'done' || !reading.result)
          throw new ApiCallError(409, 'not_read', `The reading is ${reading.status}; propose it once it is done.`);
        const missing = unchosenPersons(reading.result, persons, skipEntries ?? []);
        if (missing.length) throw new ApiCallError(400, 'choose_persons', `Choose an existing Person or "new" for ${missing.join(', ')}.`);
        const { operations, marks } = readingOperations({
          result: reading.result,
          uploadIds: reading.uploadIds,
          houses: reading.houses,
          persons,
          source,
          page: page ?? reading.context.page,
          placeId: reading.context.placeId,
          readOn: new Date().toISOString().slice(0, 10),
          link: reading.context.link,
          skip: skipEntries ?? [],
        });
        return api.post('/api/proposals', {
          formatVersion: OPERATIONS_VERSION,
          idempotencyKey: idempotencyKey ?? `mcp-${randomUUID()}`,
          note,
          operations,
          reader: { readingIds: [readingId], marks },
        });
      }),
  );

  server.registerTool(
    'list_my_proposals',
    {
      title: 'List my Proposals',
      description: "The Agent's own Proposals, newest first, with their status (pending, accepted or rejected) and the Editor's note.",
      inputSchema: z.object({
        status: ProposalStatus.optional().describe('Only Proposals with this status'),
        limit: z.number().int().min(1).max(200).optional().describe('At most this many (default 50)'),
      }),
      annotations: readOnly,
    },
    async (args) => call(() => api.get('/api/proposals', { mine: true, ...args })),
  );

  registerLeadTools(server, api);
  return server;
}
