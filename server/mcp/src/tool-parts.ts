import { z } from 'zod';
import { ApiCallError } from './api.js';

/** What the tools of the MCP server share: ids, paging, their annotations, and how one API call becomes a tool result. */
export const Id = z.uuid();
export const Paging = {
  limit: z.number().int().min(1).max(200).optional().describe('At most this many results (default 50)'),
  offset: z.number().int().min(0).optional().describe('Skip this many results, for the next page'),
};

export const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

function describeError(e: ApiCallError): string {
  if (e.status === 401) return 'The Agent token was refused: it is not valid, was revoked, or the Agent was disabled. Ask the Owner for a new token.';
  if (e.status === 429) return `${e.message}${e.retryAt ? ` (retry after ${e.retryAt})` : ''}`;
  return `The API refused the request (${e.status}${e.code ? ` ${e.code}` : ''}): ${e.message}`;
}

/** One API call as a tool result: its JSON answer, or an error the assistant can read. */
export async function call(fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (error) {
    const text = error instanceof ApiCallError ? describeError(error) : 'The Rodokmen API could not be reached. Try again later.';
    return { isError: true, content: [{ type: 'text' as const, text }] };
  }
}
