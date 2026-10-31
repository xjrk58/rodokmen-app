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

/**
 * @param {string} id
 * @param {{ up: number, down: number }} depth
 * @param {AbortSignal} [signal]
 * @returns {Promise<import('./types.js').Hourglass>}
 */
export const getHourglass = (id, depth, signal) => api(`persons/${encodeURIComponent(id)}/hourglass?up=${depth.up}&down=${depth.down}`, { signal });

/**
 * People list and search: every Person by any Name, or all of them alphabetically without a query.
 * @param {{ q: string, offset: number, limit: number }} o
 * @param {AbortSignal} [signal]
 * @returns {Promise<PersonSearchResult>}
 */
export const listPersons = (o, signal) =>
  api(`persons?${o.q.trim() ? `q=${encodeURIComponent(o.q.trim())}&` : ''}limit=${o.limit}&offset=${o.offset}`, { signal });

/** @param {string} id @param {AbortSignal} [signal] @returns {Promise<import('./types.js').CitationDetail>} */
export const getCitation = (id, signal) => api(`citations/${encodeURIComponent(id)}`, { signal });

/**
 * @param {{ bbox: [number, number, number, number], from: number, to: number }} q
 * @param {AbortSignal} [signal]
 * @returns {Promise<import('./types.js').MapEventsResult>}
 */
export const mapEvents = (q, signal) => api(`map/events?bbox=${q.bbox.map((n) => n.toFixed(5)).join(',')}&from=${q.from}&to=${q.to}&limit=5000`, { signal });

/** @param {string} placeId @param {AbortSignal} [signal] @returns {Promise<import('./types.js').PlaceEvents>} */
export const placeEvents = (placeId, signal) => api(`places/${encodeURIComponent(placeId)}/events`, { signal });

// ---------------------------------------------------------------- own account

/** @param {import('./types.js').UpdateMeBody} body @returns {Promise<Me>} */
export const updateMe = (body) => api('me', { method: 'PATCH', body });

/** @param {AbortSignal} [signal] @returns {Promise<import('./types.js').SessionList>} */
export const mySessions = (signal) => api('me/sessions', { signal });

/** @param {string} id @returns {Promise<null>} */
export const endSession = (id) => api(`me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** @param {AbortSignal} [signal] @returns {Promise<import('./types.js').PasskeyList>} */
export const myPasskeys = (signal) => api('me/passkeys', { signal });

/** @param {string} id @returns {Promise<null>} */
export const removePasskey = (id) => api(`me/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** @returns {Promise<null>} */
export const signOut = () => api('auth/sign-out', { method: 'POST' });

// ---------------------------------------------------------------- the Owner's Member management

/** @param {AbortSignal} [signal] @returns {Promise<import('./types.js').MemberList>} */
export const listMembers = (signal) => api('members', { signal });

/** @param {AbortSignal} [signal] @returns {Promise<import('./types.js').InvitationList>} */
export const listInvitations = (signal) => api('invitations', { signal });

/** @param {{ email: string, language: 'cs' | 'en' }} body @returns {Promise<import('./types.js').InvitationView>} */
export const invite = (body) => api('invitations', { method: 'POST', body });

/** @param {string} id @returns {Promise<null>} */
export const revokeInvitation = (id) => api(`invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** @param {string} id @param {import('./types.js').MemberRole} role @returns {Promise<import('./types.js').MemberView>} */
export const changeRole = (id, role) => api(`members/${encodeURIComponent(id)}/role`, { method: 'PUT', body: { role } });

/** @param {string} id @param {boolean} disabled @returns {Promise<import('./types.js').MemberView>} */
export const setDisabled = (id, disabled) => api(`members/${encodeURIComponent(id)}/${disabled ? 'disable' : 'enable'}`, { method: 'POST' });

/** @param {string} id @param {string | null} personId @returns {Promise<import('./types.js').MemberView>} */
export const linkPerson = (id, personId) => api(`members/${encodeURIComponent(id)}/person`, { method: 'PUT', body: { personId } });

// ---------------------------------------------------------------- signing in (public routes)

/** @param {string} token @returns {Promise<import('./types.js').InvitationCheck>} */
export const checkInvitation = (token) => api('auth/invitation/check', { method: 'POST', body: { token } });

/** @param {{ token: string, displayName: string, language: 'cs' | 'en' }} body @returns {Promise<import('./types.js').SignedIn>} */
export const acceptInvitation = (body) => api('auth/invitation/accept', { method: 'POST', body });

/** @param {string} email @returns {Promise<unknown>} */
export const requestEmailLink = (email) => api('auth/email-link', { method: 'POST', body: { email } });

/** @param {string} token @returns {Promise<import('./types.js').SignedIn>} */
export const verifyEmailLink = (token) => api('auth/email-link/verify', { method: 'POST', body: { token } });

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
