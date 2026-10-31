import {
  AgentList,
  AgentTokenParams,
  AgentView,
  ApiError,
  CreateAgentBody,
  CreateAgentTokenBody,
  CreatedAgent,
  IdParams,
  IssuedAgentToken,
} from '@rodokmen/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createAgent, getAgent, issueAgentToken, listAgents, revokeAgentToken, setAgentDisabled, type AgentDeps } from '../auth/agents.js';

const ownerOnly = { 401: ApiError, 403: ApiError };

/**
 * Agent accounts and their tokens (agent-access spec, "Agent accounts belong to the Owner"):
 * only the Owner creates Agents, issues their tokens and revokes them. A token is shown in full
 * only in the answer that issues it.
 */
export async function agentRoutes(fastify: FastifyInstance, deps: AgentDeps) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const owner = { config: { action: 'manageAccounts' as const } };

  app.get('/api/agents', {
    ...owner,
    schema: {
      tags: ['Agents'],
      summary: 'All Agents with their tokens (by prefix) and this hour’s use of their limits (Owner only)',
      response: { 200: AgentList, ...ownerOnly },
    },
    handler: async () => ({ items: await listAgents(deps) }),
  });

  app.post('/api/agents', {
    ...owner,
    schema: {
      tags: ['Agents'],
      summary: 'Create an Agent with its first token, shown in full only in this answer (Owner only)',
      body: CreateAgentBody,
      response: { 201: CreatedAgent, 400: ApiError, ...ownerOnly },
    },
    handler: async (req, reply) => {
      reply.code(201);
      return createAgent(deps, req.member!, req.body.name, req.body.tokenLabel ?? null);
    },
  });

  app.get('/api/agents/:id', {
    ...owner,
    schema: {
      tags: ['Agents'],
      summary: 'One Agent with its tokens (Owner only)',
      params: IdParams,
      response: { 200: AgentView, 404: ApiError, ...ownerOnly },
    },
    handler: async (req) => getAgent(deps, req.params.id),
  });

  app.post('/api/agents/:id/tokens', {
    ...owner,
    schema: {
      tags: ['Agents'],
      summary: 'Issue another token for an Agent, shown in full only in this answer (Owner only)',
      params: IdParams,
      body: CreateAgentTokenBody,
      response: { 201: IssuedAgentToken, 400: ApiError, 404: ApiError, ...ownerOnly },
    },
    handler: async (req, reply) => {
      reply.code(201);
      return issueAgentToken(deps, req.member!, req.params.id, req.body.label ?? null);
    },
  });

  app.delete('/api/agents/:id/tokens/:tokenId', {
    ...owner,
    schema: {
      tags: ['Agents'],
      summary: 'Revoke a token at once: the next request with it is refused with 401 (Owner only)',
      params: AgentTokenParams,
      response: { 204: z.null(), 404: ApiError, ...ownerOnly },
    },
    handler: async (req, reply) => {
      await revokeAgentToken(deps, req.params.id, req.params.tokenId);
      return reply.code(204).send(null);
    },
  });

  app.post('/api/agents/:id/disable', {
    ...owner,
    schema: {
      tags: ['Agents'],
      summary: 'Stop an Agent at once: none of its tokens works until it is enabled again (Owner only)',
      params: IdParams,
      response: { 200: AgentView, 404: ApiError, ...ownerOnly },
    },
    handler: async (req) => setAgentDisabled(deps, req.params.id, true),
  });

  app.post('/api/agents/:id/enable', {
    ...owner,
    schema: {
      tags: ['Agents'],
      summary: 'Let a disabled Agent use its tokens that are not revoked again (Owner only)',
      params: IdParams,
      response: { 200: AgentView, 404: ApiError, ...ownerOnly },
    },
    handler: async (req) => setAgentDisabled(deps, req.params.id, false),
  });
}
