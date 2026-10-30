// The Tree API on the same origin (ADR 0007). Every call sends the session
// cookie; errors carry the API's status, code and message.

export const API = '/api/';

export class ApiError extends Error {
  /**
   * @param {number} status 0 when the network failed
   * @param {string} code
   * @param {string} message
   */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  get offline() {
    return this.status === 0;
  }
}

/**
 * @param {string} path relative to /api/, e.g. "proposals?mine=true"
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>}
 */
export async function api(path, { method = 'GET', body } = {}) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(API + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'No connection');
  }
  const text = await response.text();
  /** @type {any} */
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new ApiError(response.status, data?.code ?? 'error', data?.message ?? response.statusText);
  return data;
}

/**
 * Uploads one image: a presigned PUT link into pending/, the bytes, then the
 * server's check, which makes the display copy. Returns the upload id.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function uploadImage(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const contentType = blob.type || 'image/jpeg';
  const ticket = await api('uploads', { method: 'POST', body: { contentType, byteSize: blob.size, sha256 } });
  let put;
  try {
    put = await fetch(ticket.putUrl, { method: 'PUT', headers: ticket.putHeaders, body: blob });
  } catch {
    throw new ApiError(0, 'offline', 'No connection');
  }
  if (!put.ok) throw new ApiError(put.status, 'upload_failed', `Upload failed (${put.status})`);
  const done = await api(`uploads/${ticket.upload.id}/complete`, { method: 'POST' });
  return done.id;
}
