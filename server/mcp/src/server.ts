import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import {
  CloseLeadBody,
  CreateLeadBody,
  LeadStatus,
  Operation,
  OPERATIONS_VERSION,
  ProposalStatus,
  RELATIONS,
  SearchRecordBody,
  UpdateLeadBody,
} from '@rodokmen/shared';
import { z } from 'zod';
import { ApiCallError, type Api } from './api.js';

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
Search before you propose, and refer to existing Persons, Places and Sources by id instead of creating duplicates. Dates are EDTF (1801-03-12, 1801~, 1801/1803).
Research leads are the family's plans: a question, where to look and what came of it. They state no fact, so you write them directly, without review. Before searching a register, list the leads of the Person or Place: a search record shows what was already looked at. Record every search you make, including one that found nothing; a lead closes as not found only with a search record. A Proposal may name the leads it answers (answersLeads): accepting it marks them found.
Your Agent is limited to 60 Proposals and 1,000 other requests per hour; a refused request says when to try again.`;

const Id = z.uuid();
const Paging = {
  limit: z.number().int().min(1).max(200).optional().describe('At most this many results (default 50)'),
  offset: z.number().int().min(0).optional().describe('Skip this many results, for the next page'),
};

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

function describeError(e: ApiCallError): string {
  if (e.status === 401) return 'The Agent token was refused: it is not valid, was revoked, or the Agent was disabled. Ask the Owner for a new token.';
  if (e.status === 429) return `${e.message}${e.retryAt ? ` (retry after ${e.retryAt})` : ''}`;
  return `The API refused the request (${e.status}${e.code ? ` ${e.code}` : ''}): ${e.message}`;
}

/** One API call as a tool result: its JSON answer, or an error the assistant can read. */
async function call(fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (error) {
    const text = error instanceof ApiCallError ? describeError(error) : 'The Rodokmen API could not be reached. Try again later.';
    return { isError: true, content: [{ type: 'text' as const, text }] };
  }
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

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
        'Read one record by id: a Person (Names, Events, Families), Family, Event (Roles, Citations), Place, House, Parish, Estate, Source (with the Parish, kinds and years of a register) or Citation (transcription) of the Tree, or a Research lead with its search records and history. A Person merged into another is answered with the kept one.',
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

const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

/** Research leads (research-leads spec): the Agent lists, writes, updates and closes them, and records its searches. */
function registerLeadTools(server: McpServer, api: Api): void {
  server.registerTool(
    'list_leads',
    {
      title: 'List Research leads',
      description:
        'Research leads: written next steps of the research, with their search records. Filter by status, Person, Place, archive or who is working on them. Look here before searching a register: a search record says what was already looked at, by whom and with what result.',
      inputSchema: z.object({
        status: z.array(LeadStatus).min(1).optional().describe('Only leads with these statuses, such as ["open", "in_progress"]'),
        personId: Id.optional().describe('Only leads about this Person'),
        placeId: Id.optional().describe('Only leads about this Place'),
        archive: z.string().min(1).max(400).optional().describe('Only leads to look in this archive'),
        assigneeId: Id.optional().describe('Only leads this Member or Agent is working on'),
        ...Paging,
      }),
      annotations: readOnly,
    },
    async ({ status, ...args }) => call(() => api.get('/api/leads', { ...args, ...(status ? { status: [...new Set(status)].join(',') } : {}) })),
  );

  server.registerTool(
    'create_lead',
    {
      title: 'Write a Research lead',
      description:
        'Write a Research lead: a question and its reason, where to look (archive, register Source, years, pages) and the Persons and Places it concerns. It is written at once, without review, under your name. Searches already made may come with it; a lead may start closed as not found only with the search that found nothing.',
      inputSchema: CreateLeadBody,
      annotations: writes,
    },
    async (body) => call(() => api.post('/api/leads', body)),
  );

  server.registerTool(
    'update_lead',
    {
      title: 'Change a Research lead',
      description:
        'Change fields of a Research lead (its question, where to look, the Persons and Places, who works on it, its status), naming the version you read; a lead changed since is refused, so read it again. Not found needs a search record (close_lead does both at once).',
      inputSchema: z.object({ leadId: Id, ...UpdateLeadBody.shape }),
      annotations: writes,
    },
    async ({ leadId, ...body }) => call(() => api.patch(`/api/leads/${leadId}`, body)),
  );

  server.registerTool(
    'add_search_record',
    {
      title: 'Record a search',
      description:
        'Record one search made on a lead: the register Source or the archive, the years and pages looked at, when (EDTF, today when left out), who looked (you when left out) and what was found, including nothing.',
      inputSchema: z.object({ leadId: Id, search: SearchRecordBody }),
      annotations: writes,
    },
    async ({ leadId, search }) => call(() => api.post(`/api/leads/${leadId}/searches`, search)),
  );

  server.registerTool(
    'close_lead',
    {
      title: 'Close a Research lead',
      description:
        'Close a lead as found or not found, with the outcome and the search that closes it, naming the version you read. Not found needs at least one search record: give the search here, or record it first. A fact you found still goes in a Proposal that names the lead (submit_proposal, answersLeads).',
      inputSchema: z.object({ leadId: Id, ...CloseLeadBody.shape }),
      annotations: writes,
    },
    async ({ leadId, ...body }) => call(() => api.post(`/api/leads/${leadId}/close`, body)),
  );
}
