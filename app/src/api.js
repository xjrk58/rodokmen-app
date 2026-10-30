// The Tree API on the same origin (ADR 0007). Every call sends the session
// cookie; errors carry the API's status, code and message. The typed wrappers
// below name the payload types of shared/src/schemas (types only: the app does
// not load Zod).

import { hex } from './text.js';

/** @typedef {import('./types.js').Me} Me */
/** @typedef {import('./types.js').PersonDetail} PersonDetail */
/** @typedef {import('./types.js').PersonSearchResult} PersonSearchResult */
/** @typedef {import('./types.js').PlaceSearchResult} PlaceSearchResult */
/** @typedef {import('./types.js').SourceSearchResult} SourceSearchResult */
/** @typedef {import('./types.js').ProposalView} ProposalView */
/** @typedef {import('./types.js').ProposalList} ProposalList */
/** @typedef {import('./types.js').UndoPreview} UndoPreview */
/** @typedef {import('./types.js').History} History */
/** @typedef {import('./types.js').UploadTicket} UploadTicket */
/** @typedef {import('./types.js').UploadView} UploadView */
/** @typedef {import('./types.js').NotificationSettings} NotificationSettings */
/** @typedef {import('./types.js').SubmitProposalBody} SubmitProposalBody */
/** @typedef {import('./types.js').MergeBody} MergeBody */
/** @typedef {import('./types.js').RejectBody} RejectBody */
/** @typedef {import('./types.js').AcceptBody} AcceptBody */
/** @typedef {import('./types.js').UndoBody} UndoBody */

export const API = '/api/';

export class ApiError extends Error {
  /**
   * @param {number} status 0 when the network failed
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(status, code, message, options) {
    super(message, options);
    this.status = status;
    this.code = code;
  }

  get offline() {
    return this.status === 0;
  }
}

/**
 * What to tell the Member about a failure.
 * @param {unknown} error
 */
export const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * The code and message of an API error body ({ code, message }), when it has them.
 * @param {unknown} data
 * @returns {{ code?: string, message?: string }}
 */
function errorBody(data) {
  if (typeof data !== 'object' || data === null) return {};
  const code = 'code' in data && typeof data.code === 'string' ? data.code : undefined;
  const message = 'message' in data && typeof data.message === 'string' ? data.message : undefined;
  return { code, message };
}

/** @param {string} text @returns {unknown} */
function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * A call to the API. T is the payload type the route answers with; callers
 * name it through a typed wrapper or the type of the variable they assign to.
 * @template [T=unknown]
 * @param {string} path relative to /api/, e.g. "proposals?mine=true"
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [options] an aborted signal rejects with its reason
 * @returns {Promise<T>}
 */
export async function api(path, { method = 'GET', body, signal } = {}) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(API + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, 'offline', 'No connection', { cause: error });
  }
  const data = parseJson(await response.text());
  if (!response.ok) {
    const { code, message } = errorBody(data);
    // HTTP/2 has no reason phrase, so statusText is often empty.
    throw new ApiError(response.status, code ?? 'error', message ?? (response.statusText || `HTTP ${response.status}`));
  }
  return /** @type {T} */ (data);
}

// ---------------------------------------------------------------- typed routes

/** @param {AbortSignal} [signal] @returns {Promise<Me>} */
export const getMe = (signal) => api('me', { signal });

/** @param {string} id @param {AbortSignal} [signal] @returns {Promise<PersonDetail>} */
export const getPerson = (id, signal) => api(`persons/${encodeURIComponent(id)}`, { signal });

/** @param {string} q @returns {Promise<PersonSearchResult>} */
export const searchPersons = (q) => api(`persons?q=${encodeURIComponent(q)}&limit=8`);

/** @param {string} q @returns {Promise<PlaceSearchResult>} */
export const searchPlaces = (q) => api(`places?q=${encodeURIComponent(q)}&limit=8`);

/** @param {string} q @returns {Promise<SourceSearchResult>} */
export const searchSources = (q) => api(`sources?q=${encodeURIComponent(q)}&limit=8`);

/** @param {SubmitProposalBody} body @returns {Promise<ProposalView>} */
export const submitProposal = (body) => api('proposals', { method: 'POST', body });

/** @param {AbortSignal} [signal] @returns {Promise<ProposalList>} */
export const myProposals = (signal) => api('proposals?mine=true&limit=100', { signal });

/** @param {AbortSignal} [signal] @returns {Promise<ProposalList>} */
export const reviewQueue = (signal) => api('review?limit=50', { signal });

/** @param {string} id @param {AcceptBody} body @returns {Promise<ProposalView>} */
export const acceptProposal = (id, body) => api(`proposals/${encodeURIComponent(id)}/accept`, { method: 'POST', body });

/** @param {string} id @param {RejectBody} body @returns {Promise<ProposalView>} */
export const rejectProposal = (id, body) => api(`proposals/${encodeURIComponent(id)}/reject`, { method: 'POST', body });

/** @param {string} keepId @param {MergeBody} body @returns {Promise<ProposalView>} */
export const mergePersons = (keepId, body) => api(`persons/${encodeURIComponent(keepId)}/merge`, { method: 'POST', body });

/** @param {string} kind @param {string} id @param {AbortSignal} [signal] @returns {Promise<History>} */
export const getHistory = (kind, id, signal) => api(`history/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { signal });

/** @param {string} proposalId @returns {Promise<UndoPreview>} */
export const undoPreview = (proposalId) => api(`proposals/${encodeURIComponent(proposalId)}/undo`);

/** @param {string} proposalId @param {UndoBody} body @returns {Promise<ProposalView>} */
export const undoProposal = (proposalId, body) => api(`proposals/${encodeURIComponent(proposalId)}/undo`, { method: 'POST', body });

/** @param {AbortSignal} [signal] @returns {Promise<NotificationSettings>} */
export const notificationSettings = (signal) => api('me/notifications', { signal });

/** @param {NotificationSettings} body @returns {Promise<NotificationSettings>} */
export const setNotificationSettings = (body) => api('me/notifications', { method: 'PUT', body });

/** The URL of an upload's display copy. @param {string} uploadId */
export const uploadUrl = (uploadId) => `${API}uploads/${encodeURIComponent(uploadId)}`;

/**
 * Uploads one image: a presigned PUT link into pending/, the bytes, then the
 * server's check, which makes the display copy. Returns the upload id.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function uploadImage(blob) {
  const sha256 = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())));
  const contentType = blob.type || 'image/jpeg';
  /** @type {UploadTicket} */
  const ticket = await api('uploads', { method: 'POST', body: { contentType, byteSize: blob.size, sha256 } });
  let put;
  try {
    put = await fetch(ticket.putUrl, { method: 'PUT', headers: ticket.putHeaders, body: blob });
  } catch (error) {
    throw new ApiError(0, 'offline', 'No connection', { cause: error });
  }
  if (!put.ok) throw new ApiError(put.status, 'upload_failed', `Upload failed (${put.status})`);
  /** @type {UploadView} */
  const done = await api(`uploads/${encodeURIComponent(ticket.upload.id)}/complete`, { method: 'POST' });
  return done.id;
}
