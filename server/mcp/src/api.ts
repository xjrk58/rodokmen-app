import { createHash } from 'node:crypto';

/**
 * A client of the Rodokmen API, authenticated with an Agent token. It is everything the MCP
 * server knows of the Tree: the server has no database access of its own, so it can offer
 * nothing the token may not do through the API (agent-access spec, "MCP server").
 */
export interface Api {
  get(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
  /** Uploads an image as the API does it (a presigned PUT link, then the server's check) and returns its upload id. */
  upload(data: Buffer, contentType: string): Promise<string>;
}

/** An API answer other than success, as the API described it. */
export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    /** For 429: when the Agent may try again. */
    readonly retryAt: string | null = null,
  ) {
    super(message);
    this.name = 'ApiCallError';
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
/** An image of up to 25 MB may take a while to go up. */
const UPLOAD_TIMEOUT_MS = 120_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const stringOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

async function errorOf(res: Response): Promise<ApiCallError> {
  const body: unknown = await res.json().catch(() => null);
  const message = isRecord(body) && typeof body.message === 'string' ? body.message : `The API answered ${res.status}.`;
  return new ApiCallError(res.status, isRecord(body) ? stringOrNull(body.code) : null, message, isRecord(body) ? stringOrNull(body.retryAt) : null);
}

/** `baseUrl` is the origin the API is served from, such as https://rodokmen.example. */
export function apiClient(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): Api {
  const request = async (method: 'GET' | 'POST', path: string, init: { query?: Record<string, string | number | boolean | undefined>; body?: unknown }) => {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(init.query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
    const res = await fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw await errorOf(res);
    const body: unknown = await res.json();
    return body;
  };
  const field = (v: unknown, key: string): unknown => (isRecord(v) ? v[key] : undefined);
  return {
    get: (path, query) => request('GET', path, { query }),
    post: (path, body) => request('POST', path, { body }),
    async upload(data, contentType) {
      const sha256 = createHash('sha256').update(data).digest('hex');
      const ticket = await request('POST', '/api/uploads', { body: { contentType, byteSize: data.length, sha256 } });
      const id = field(field(ticket, 'upload'), 'id');
      const putUrl = field(ticket, 'putUrl');
      const putHeaders = field(ticket, 'putHeaders');
      if (typeof id !== 'string' || typeof putUrl !== 'string') throw new ApiCallError(502, null, 'The API answered the upload request without a link.');
      // The link is presigned for the image store: it carries no Agent token.
      const headers = isRecord(putHeaders) ? Object.fromEntries(Object.entries(putHeaders).map(([k, v]) => [k, String(v)])) : { 'content-type': contentType };
      const put = await fetchImpl(putUrl, { method: 'PUT', headers, body: new Uint8Array(data), signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
      if (!put.ok) throw new ApiCallError(put.status, 'upload_failed', `The image store refused the upload (${put.status}).`);
      await request('POST', `/api/uploads/${id}/complete`, {});
      return id;
    },
  };
}
