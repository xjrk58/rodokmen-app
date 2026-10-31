/**
 * A client of the Rodokmen API, authenticated with an Agent token. It is everything the MCP
 * server knows of the Tree: the server has no database access of its own, so it can offer
 * nothing the token may not do through the API (agent-access spec, "MCP server").
 */
export interface Api {
  get(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
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
  return {
    get: (path, query) => request('GET', path, { query }),
    post: (path, body) => request('POST', path, { body }),
  };
}
