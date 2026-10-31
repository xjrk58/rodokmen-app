import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { apiClient, ApiCallError } from './api.js';
import { createRodokmenServer } from './server.js';

/**
 * The MCP server over streamable HTTP at /mcp (agent-access spec, "MCP server"), behind the
 * same domain as the app (deploy/Caddyfile). Stateless: each request is served by a fresh
 * server instance holding the caller's token.
 *
 * Every request needs `Authorization: Bearer <Agent token>`. The token is checked with the API
 * (GET /api/me, one read of the Agent's hourly limit) before anything is served, and each tool
 * then calls the API with it, so a revoked token stops working at once.
 */
export interface HttpOptions {
  /** Where the API is reached from here, such as http://api:3000 inside the Docker network. */
  apiUrl: string;
  /** Host names the server answers to (the Host header, and the Origin header when a browser sends one). */
  allowedHosts: string[];
  fetch?: typeof fetch;
  onerror?: (error: Error) => void;
}

export const MCP_PATH = '/mcp';

function bearerToken(header: string | undefined): string | null {
  const match = header === undefined ? null : /^bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

function answer(res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

/** What GET /api/me answers for an Agent token, as far as the check reads it. */
const AgentMe = z.object({ id: z.string(), role: z.literal('agent') });

const CHALLENGE = { 'www-authenticate': 'Bearer realm="Rodokmen"' };

export function createHttpHandler(options: HttpOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const handler = createMcpHandler(
    ({ authInfo }) => {
      if (!authInfo) throw new Error('an MCP request reached the server without a checked token');
      return createRodokmenServer(apiClient(options.apiUrl, authInfo.token, options.fetch));
    },
    { onerror: options.onerror },
  );
  const serve = toNodeHandler(handler, { onerror: options.onerror });
  const validateHost = hostHeaderValidation(options.allowedHosts);
  const validateOrigin = originValidation(options.allowedHosts);

  return async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === `${MCP_PATH}/health` && req.method === 'GET') return answer(res, 200, { status: 'ok' });
    if (path !== MCP_PATH) return answer(res, 404, { error: 'not_found', message: `The MCP endpoint is ${MCP_PATH}.` });
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;

    const token = bearerToken(req.headers.authorization);
    if (!token) return answer(res, 401, { error: 'unauthorized', message: 'An Agent token is required: Authorization: Bearer rdk_ag_…' }, CHALLENGE);
    const checked = await checkToken(options, token);
    if ('refusal' in checked) return answer(res, checked.refusal.status, checked.refusal.body, checked.refusal.headers);
    // `auth` is handed to the server factory above as authInfo.
    await serve(Object.assign(req, { auth: { token, clientId: checked.agentId, scopes: [] } }), res);
  };
}

interface Refusal {
  status: number;
  body: object;
  headers: Record<string, string>;
}

/** Asks the API whose token this is: an Agent's id, or the answer that refuses the request. */
async function checkToken(options: HttpOptions, token: string): Promise<{ agentId: string } | { refusal: Refusal }> {
  let me: unknown;
  try {
    me = await apiClient(options.apiUrl, token, options.fetch).get('/api/me');
  } catch (error) {
    if (!(error instanceof ApiCallError)) {
      options.onerror?.(error instanceof Error ? error : new Error(String(error)));
      return { refusal: { status: 502, body: { error: 'api_unreachable', message: 'The Rodokmen API could not be reached.' }, headers: {} } };
    }
    if (error.status === 429) {
      const headers: Record<string, string> = error.retryAt ? { 'retry-after': retryAfter(error.retryAt) } : {};
      return { refusal: { status: 429, body: { error: 'rate_limited', message: error.message, retryAt: error.retryAt }, headers } };
    }
    return { refusal: { status: 401, body: { error: 'invalid_token', message: 'This token is not valid.' }, headers: CHALLENGE } };
  }
  const agent = AgentMe.safeParse(me);
  if (!agent.success)
    return { refusal: { status: 401, body: { error: 'invalid_token', message: 'Only Agent tokens open the MCP server.' }, headers: CHALLENGE } };
  return { agentId: agent.data.id };
}

function retryAfter(retryAt: string): string {
  return String(Math.max(1, Math.ceil((Date.parse(retryAt) - Date.now()) / 1000)));
}
