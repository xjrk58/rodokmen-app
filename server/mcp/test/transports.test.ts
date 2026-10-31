import { createServer, request, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { IssuedAgentToken, PlaceSearchResult } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { freePort } from '../../test/helpers.js';
import { createHttpHandler } from '../src/http.js';
import { resultOf, useWorld, type World } from './world.js';

/** A JSON-RPC answer, as far as the 2025-protocol test reads it. */
const Answer = z.object({
  result: z.object({ serverInfo: z.object({ name: z.string() }).optional(), tools: z.array(z.object({ name: z.string() })).optional() }).optional(),
});

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

/** A fresh token for the test's Agent, issued by the Owner through the API. */
async function issueToken(w: World): Promise<IssuedAgentToken> {
  return IssuedAgentToken.parse((await w.as('owner', 'POST', `/api/agents/${w.agent.id}/tokens`, {})).json());
}

const revoke = async (w: World, tokenId: string) => expect((await w.as('owner', 'DELETE', `/api/agents/${w.agent.id}/tokens/${tokenId}`)).statusCode).toBe(204);

async function places(client: Client) {
  return resultOf(await client.callTool({ name: 'search_places', arguments: { q: 'Lhota' } }));
}

describe('the MCP server over stdio', () => {
  const world = useWorld('Stdio agent');
  const clients: Client[] = [];

  const connect = async (env: Record<string, string>) => {
    const transport = new StdioClientTransport({
      command: TSX,
      args: ['--conditions=@rodokmen/source', 'src/stdio.ts'],
      cwd: PACKAGE_DIR,
      env: { PATH: process.env.PATH ?? '', ...env },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    clients.push(client);
    await client.connect(transport);
    return client;
  };

  afterAll(async () => {
    for (const c of clients) await c.close().catch(() => undefined);
  });

  it('a client connects, lists the tools and calls one; once the token is revoked, the next tool call fails', async () => {
    const w = world();
    const issued = await issueToken(w);
    const client = await connect({ RODOKMEN_URL: w.apiUrl, RODOKMEN_TOKEN: issued.token });
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('submit_proposal');
    const found = await places(client);
    expect(found.error).toBeNull();
    expect(PlaceSearchResult.parse(found.json).items.length).toBeGreaterThan(0);

    await revoke(w, issued.id);
    const refused = await places(client);
    expect(refused.error).toBe('The Agent token was refused: it is not valid, was revoked, or the Agent was disabled. Ask the Owner for a new token.');
  }, 60_000);

  it('without a valid token the server does not start, so no tool can be called', async () => {
    const w = world();
    await expect(connect({ RODOKMEN_URL: w.apiUrl, RODOKMEN_TOKEN: `rdk_ag_${'0'.repeat(64)}` })).rejects.toThrow();
    await expect(connect({ RODOKMEN_URL: w.apiUrl })).rejects.toThrow();
  }, 60_000);
});

describe('the MCP server over streamable HTTP at /mcp', () => {
  const world = useWorld('HTTP agent');
  let server: Server;
  let mcpUrl: URL;
  const clients: Client[] = [];
  const errors: Error[] = [];

  const connect = async (token: string | null) => {
    const transport = new StreamableHTTPClientTransport(mcpUrl, token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : {});
    const client = new Client({ name: 'http-test', version: '1.0.0' });
    clients.push(client);
    await client.connect(transport);
    return client;
  };

  beforeAll(async () => {
    const w = world();
    const handle = createHttpHandler({ apiUrl: w.apiUrl, allowedHosts: ['127.0.0.1', 'localhost'], onerror: (e) => errors.push(e) });
    server = createServer((req, res) => void handle(req, res));
    const port = await freePort();
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  });
  afterAll(async () => {
    for (const c of clients) await c.close().catch(() => undefined);
    await new Promise((resolve) => server?.close(resolve));
  });

  it('a client connects with the Agent token, lists the tools and calls one', async () => {
    const client = await connect(world().token);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('get_ancestors');
    const found = await places(client);
    expect(found.error).toBeNull();
    expect(PlaceSearchResult.parse(found.json).items.length).toBeGreaterThan(0);
  });

  it('a client of the 2025 protocol (initialize, then requests) is served too', async () => {
    const post = async (body: object) => {
      const res = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
          authorization: `Bearer ${world().token}`,
        },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      // Answered as JSON or as one server-sent event.
      const data = text.startsWith('{')
        ? text
        : text
            .split('\n')
            .find((l) => l.startsWith('data: '))!
            .slice(6);
      return Answer.parse(JSON.parse(data));
    };
    const init = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } },
    });
    expect(init.result?.serverInfo?.name).toBe('rodokmen');
    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(list.result?.tools?.map((t) => t.name)).toContain('submit_proposal');
  });

  it('without a token, or with an unknown one, the endpoint answers 401 and no client connects', async () => {
    for (const token of [null, `rdk_ag_${'0'.repeat(64)}`, 'not-a-token']) {
      const res = await fetch(mcpUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_places', arguments: { q: 'Lhota' } } }),
      });
      expect(res.status, String(token)).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer realm="Rodokmen"');
      await expect(connect(token), String(token)).rejects.toThrow();
    }
  });

  it('a revoked token: the next tool call fails, and the endpoint refuses new requests with 401', async () => {
    const w = world();
    const issued = await issueToken(w);
    const client = await connect(issued.token);
    expect((await places(client)).error).toBeNull();
    await revoke(w, issued.id);
    await expect(client.callTool({ name: 'search_places', arguments: { q: 'Lhota' } })).rejects.toThrow();
    await expect(connect(issued.token)).rejects.toThrow();
  });

  it('answers only at /mcp, and only for its own host name', async () => {
    expect((await fetch(new URL('/other', mcpUrl))).status).toBe(404);
    expect((await fetch(new URL('/mcp/health', mcpUrl))).status).toBe(200);
    // fetch cannot set Host; a plain request can, as a rebinding attack would.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        mcpUrl,
        { method: 'POST', headers: { host: 'evil.example', authorization: `Bearer ${world().token}`, 'content-type': 'application/json' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(403);
    expect(errors).toEqual([]);
  });
});
