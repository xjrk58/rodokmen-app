#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { apiClient, ApiCallError } from './api.js';
import { createRodokmenServer } from './server.js';

/**
 * The MCP server over stdio, for an assistant on the Agent's own machine (agent-access spec,
 * "MCP server"). It calls the API at RODOKMEN_URL with the Agent token in RODOKMEN_TOKEN:
 *
 *   RODOKMEN_URL=https://rodokmen.example RODOKMEN_TOKEN=rdk_ag_… node dist/stdio.js
 *
 * stdout carries the protocol; messages go to stderr.
 */
async function main(): Promise<number | null> {
  const url = process.env.RODOKMEN_URL;
  const token = process.env.RODOKMEN_TOKEN;
  if (!url || !token) {
    console.error('Set RODOKMEN_URL (the Rodokmen address, such as https://rodokmen.example) and RODOKMEN_TOKEN (an Agent token from the Owner).');
    return 2;
  }
  const api = apiClient(url, token);
  // A wrong token is reported now rather than at the first tool call.
  try {
    await api.get('/api/me');
  } catch (error) {
    console.error(error instanceof ApiCallError ? `The API refused the token (${error.status}): ${error.message}` : `The API at ${url} could not be reached.`);
    return 1;
  }
  serveStdio(() => createRodokmenServer(api), { onerror: (error) => console.error(error) });
  return null;
}

main().then(
  (code) => {
    if (code !== null) process.exit(code);
  },
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
