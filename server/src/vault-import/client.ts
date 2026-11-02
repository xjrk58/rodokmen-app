import { createHash } from 'node:crypto';
import { ImportMap, type ImportMapView } from '@rodokmen/shared';
import { z } from 'zod';

const ProblemBody = z.object({ message: z.string().optional(), code: z.string().optional(), retryAt: z.string().optional() });

/**
 * The importer is a client of the public API with an Agent token (design, "Importer is an API
 * client, not a database script"): everything it submits goes through the same checks, log and
 * review as any Agent's Proposal.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

export interface Client {
  /** The JSON answer; callers check it with the shared schemas. */
  get(path: string): Promise<unknown>;
  send(method: 'POST' | 'PUT', path: string, body: unknown): Promise<unknown>;
  /** PUTs a file to a presigned upload link. */
  put(url: string, headers: Record<string, string>, body: Buffer): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A client for RODOKMEN_URL with an Agent token; waits out a 429 once per request. */
export function apiClient(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): Client {
  const base = baseUrl.replace(/\/$/, '');
  const call = async (method: string, path: string, body?: unknown, retried = false): Promise<unknown> => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : null;
    if (res.ok) return json;
    const error = ProblemBody.safeParse(json).data ?? {};
    if (res.status === 429 && !retried && error.retryAt) {
      await sleep(Math.max(0, new Date(error.retryAt).getTime() - Date.now()) + 1000);
      return call(method, path, body, true);
    }
    throw new ApiError(res.status, error.code, `${method} ${path}: ${res.status} ${error.message ?? text}`);
  };
  return {
    get: (path) => call('GET', path),
    send: (method, path, body) => call(method, path, body),
    async put(url, headers, body) {
      const res = await fetchImpl(url, { method: 'PUT', headers, body: new Uint8Array(body) });
      if (!res.ok) throw new ApiError(res.status, 'upload_failed', `upload to the bucket failed (${res.status})`);
    },
  };
}

/** The whole id map, page by page. */
export async function loadMap(client: Client): Promise<Map<string, ImportMapView>> {
  const out = new Map<string, ImportMapView>();
  let after: string | null = null;
  do {
    const page: ImportMap = ImportMap.parse(await client.get(`/api/import-map?limit=5000${after === null ? '' : `&after=${encodeURIComponent(after)}`}`));
    for (const e of page.entries) out.set(e.key, e);
    after = page.next;
  } while (after !== null);
  return out;
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
