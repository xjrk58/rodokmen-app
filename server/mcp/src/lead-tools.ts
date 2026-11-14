import type { McpServer } from '@modelcontextprotocol/server';
import { CloseLeadBody, CreateLeadBody, LeadStatus, SearchRecordBody, UpdateLeadBody } from '@rodokmen/shared';
import { z } from 'zod';
import type { Api } from './api.js';
import { call, Id, Paging, readOnly, writes } from './tool-parts.js';

/** Research leads (research-leads spec): the Agent lists, writes, updates and closes them, and records its searches. */
export function registerLeadTools(server: McpServer, api: Api): void {
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
