import {
  ApiError,
  CloseLeadBody,
  CreateLeadBody,
  IdParams,
  LeadDetail,
  LeadList,
  LeadListQuery,
  LeadSuggestion,
  RateLimited,
  SearchRecordBody,
  SuggestionList,
  SuggestionListQuery,
  UpdateLeadBody,
} from '@rodokmen/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ApiProblem } from '../auth/problem.js';
import { acceptSuggestion, dismissSuggestion, listSuggestions } from '../leads/suggestions.js';
import { addSearch, closeLead, createLead, updateLead, type LeadDeps } from '../leads/service.js';
import { leadDetail, listLeads } from '../leads/views.js';

/** Members and Agents; Agents within their hourly limit. */
const signedIn = { 401: ApiError, 403: ApiError, 429: RateLimited };
/** Members only: an Agent does not decide on suggested leads. */
const membersOnly = { 401: ApiError, 403: ApiError };

/**
 * Research leads (research-leads spec). Every Member and Agent reads them; Members and Agents
 * write leads and search records at once, without review (action writeLeads); only Members accept
 * or dismiss a suggested lead (action decideSuggestions). See mayDo in shared/src/rules.ts.
 */
export async function leadRoutes(fastify: FastifyInstance, deps: LeadDeps) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { db, clock } = deps;

  app.get('/api/leads', {
    schema: {
      tags: ['Leads'],
      summary: 'Research leads, filtered by status, Person, Place, archive and who is working on them: open and in-progress first, newest change first',
      querystring: LeadListQuery,
      response: { 200: LeadList, 400: ApiError, ...signedIn },
    },
    handler: async (req) => ({ ...(await listLeads(db, clock, req.query)), limit: req.query.limit, offset: req.query.offset }),
  });

  app.post('/api/leads', {
    config: { action: 'writeLeads' },
    schema: {
      tags: ['Leads'],
      summary:
        'Write a Research lead: a question and its reason, where to look, the Persons and Places it concerns. Written at once, without review; searches already made may come with it',
      body: CreateLeadBody,
      response: { 201: LeadDetail, 400: ApiError, ...signedIn },
    },
    handler: async (req, reply) => {
      reply.code(201);
      return createLead(deps, req.member!, req.body);
    },
  });

  app.get('/api/leads/:id', {
    schema: {
      tags: ['Leads'],
      summary: 'A Research lead with its search records and its history of changes',
      params: IdParams,
      response: { 200: LeadDetail, 404: ApiError, ...signedIn },
    },
    handler: async (req) => {
      const lead = await leadDetail(db, clock, req.params.id);
      if (!lead) throw new ApiProblem(404, 'not_found', 'No lead with this id.');
      return lead;
    },
  });

  app.patch('/api/leads/:id', {
    config: { action: 'writeLeads' },
    schema: {
      tags: ['Leads'],
      summary: 'Change a Research lead, against the version you read (409 when it changed since). Not found needs a search record',
      params: IdParams,
      body: UpdateLeadBody,
      response: { 200: LeadDetail, 400: ApiError, 404: ApiError, 409: ApiError, ...signedIn },
    },
    handler: async (req) => updateLead(deps, req.member!, req.params.id, req.body),
  });

  app.post('/api/leads/:id/searches', {
    config: { action: 'writeLeads' },
    schema: {
      tags: ['Leads'],
      summary: 'Record a search made on a lead: the Source or archive, the years and pages, when, by whom and what was found, including nothing',
      params: IdParams,
      body: SearchRecordBody,
      response: { 201: LeadDetail, 400: ApiError, 404: ApiError, ...signedIn },
    },
    handler: async (req, reply) => {
      reply.code(201);
      return addSearch(deps, req.member!, req.params.id, req.body);
    },
  });

  app.post('/api/leads/:id/close', {
    config: { action: 'writeLeads' },
    schema: {
      tags: ['Leads'],
      summary: 'Close a lead as found or not found, with the outcome and the search that closes it. Not found needs at least one search record',
      params: IdParams,
      body: CloseLeadBody,
      response: { 200: LeadDetail, 400: ApiError, 404: ApiError, 409: ApiError, ...signedIn },
    },
    handler: async (req) => closeLead(deps, req.member!, req.params.id, req.body),
  });

  // ---------------------------------------------------------------- suggested leads

  app.get('/api/lead-suggestions', {
    schema: {
      tags: ['Leads'],
      summary: 'Leads the gap finder suggests, apart from the leads, until a Member accepts or dismisses them',
      querystring: SuggestionListQuery,
      response: { 200: SuggestionList, 400: ApiError, ...signedIn },
    },
    handler: async (req) => ({ ...(await listSuggestions(db, clock, req.query)), limit: req.query.limit, offset: req.query.offset }),
  });

  app.post('/api/lead-suggestions/:id/accept', {
    config: { action: 'decideSuggestions' },
    schema: {
      tags: ['Leads'],
      summary: 'Accept a suggested lead (Members): it becomes a lead, and is not suggested again',
      params: IdParams,
      response: { 201: LeadDetail, 404: ApiError, 409: ApiError, ...membersOnly },
    },
    handler: async (req, reply) => {
      reply.code(201);
      return acceptSuggestion(deps, req.member!, req.params.id);
    },
  });

  app.post('/api/lead-suggestions/:id/dismiss', {
    config: { action: 'decideSuggestions' },
    schema: {
      tags: ['Leads'],
      summary: 'Dismiss a suggested lead (Members): the gap finder does not suggest it again',
      params: IdParams,
      response: { 200: LeadSuggestion, 404: ApiError, 409: ApiError, ...membersOnly },
    },
    handler: async (req) => dismissSuggestion(deps, req.member!, req.params.id),
  });
}
