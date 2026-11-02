import { mayDo, type Action } from '@rodokmen/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import type { Db } from '../db/db.js';
import type { Account } from '../db/types.js';
import type { Clock } from '../clock.js';
import { resolveAgentToken } from './agents.js';
import { takeSlot, type LimitKind } from './limits.js';
import { resolveSession, SESSION_COOKIE, type SessionOptions } from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in Member or the Agent of the token, or null. Set for every request except to public pages and files. */
    member: Account | null;
    sessionId: string | null;
    /** The Agent token the request came with. */
    agentTokenId: string | null;
  }
  interface FastifyContextConfig {
    /** Reachable without a session: the health check and the sign-in steps. */
    public?: boolean;
    /**
     * What the route does, for the role-and-action rule (mayDo in shared/src/rules.ts). A GET
     * or HEAD route that names none reads; every other route that is not public must name one.
     */
    action?: Action;
    /** Agents' requests to this route count as submitted Proposals instead of reads. */
    agentLimit?: LimitKind;
  }
}

export interface AuthOptions {
  db: Db;
  clock: Clock;
  session: SessionOptions;
  publicOrigin: string;
  cookieSecure: boolean;
}

export function sessionCookieOptions(options: Pick<AuthOptions, 'cookieSecure'>, maxAgeSeconds: number) {
  return { path: '/', httpOnly: true, secure: options.cookieSecure, sameSite: 'lax' as const, maxAge: maxAgeSeconds };
}

export function unauthorized(reply: FastifyReply, message = 'Sign in to continue.') {
  return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message, code: 'unauthorized' });
}

export function forbidden(reply: FastifyReply, message: string) {
  return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message, code: 'forbidden' });
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const READING = new Set(['GET', 'HEAD']);

/** The action of a route: the one it names, or `read` for GET and HEAD. Null when it names none. */
export function actionOf(route: { method: string | string[]; config?: { action?: Action } }): Action | null {
  if (route.config?.action) return route.config.action;
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  return methods.every((m) => READING.has(m.toUpperCase())) ? 'read' : null;
}

function refusal(member: Account, action: Action): string {
  if (member.role === 'agent') return 'An Agent may only read the Tree, submit Proposals and write Research leads.';
  if (action === 'manageAccounts' || action === 'markFamilyRoots' || action === 'acceptBatch') return 'Only the Owner can do this.';
  return 'Only Editors can do this.';
}

/** The token of an `Authorization: Bearer …` header; undefined without one. */
function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined || !/^bearer /i.test(header)) return undefined;
  return header.slice('bearer '.length).trim();
}

/**
 * Every route needs a signed-in Member or an Agent token unless it is marked public
 * (tree-read-api spec, "Members and Agents only"): one by one with `config: { public: true }`
 * (the health check and the sign-in steps), or all routes of a scope with {@link publicScope}
 * (the sign-in pages and the map app's files). Requests that match no route need one too, so
 * an unknown path answers 401 to anyone not signed in.
 *
 * Then every route asks the role-and-action rule (agent-access spec, "Read and propose only";
 * mayDo in shared/src/rules.ts) whether the caller's role may do the route's action, and
 * answers 403 if not. Agents authenticate with `Authorization: Bearer rdk_ag_…`; a revoked,
 * unknown or malformed token answers 401. An Agent's allowed requests are counted against its
 * hourly limits (agent-access spec, "Rate limits"), and answer 429 with the retry time beyond.
 *
 * The decision follows the route the router chose, never the URL as written: the router decodes
 * and normalises the path first (`/%61pi/persons/…` reaches `/api/persons/:id`), so a check on
 * the raw URL could be walked around. It runs in onRequest, before validation and before any
 * lookup of the requested record, so a 401 or 403 reveals nothing about whether a record exists.
 *
 * Writes authenticated by cookie must come from our own origin (defence in depth on top of
 * SameSite=Lax). A request with a bearer token is authenticated by the token alone.
 */
async function authPlugin(app: FastifyInstance, options: AuthOptions) {
  app.decorateRequest('member', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('agentTokenId', null);

  // Deny by default: a route that changes something must say what it does.
  app.addHook('onRoute', (route: RouteOptions) => {
    if (route.config?.public !== true && actionOf(route) === null) {
      throw new Error(`${String(route.method)} ${route.url} needs config.action (see auth/plugin.ts)`);
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    const isPublic = request.routeOptions.config?.public === true;
    const bearer = bearerToken(request.headers.authorization);
    if (bearer !== undefined) {
      // Public routes need no token and ignore one.
      if (isPublic) return;
      const agent = await resolveAgentToken(options.db, options.clock, bearer);
      if (!agent) return unauthorized(reply, 'This token is not valid.');
      request.member = agent.account;
      request.agentTokenId = agent.tokenId;
    } else {
      const refused = await authenticateCookie(request, reply, options, isPublic);
      if (refused) return refused;
    }
    if (isPublic) return;
    return authorize(request, reply, options);
  });
}

/** Signs the request in by its session cookie; returns the answer when a cross-site write is refused. */
async function authenticateCookie(request: FastifyRequest, reply: FastifyReply, options: AuthOptions, isPublic: boolean) {
  // Public pages and files never look at the session; public API routes (sign-out) do.
  const token = isPublic && !request.routeOptions.url?.startsWith('/api/') ? undefined : request.cookies[SESSION_COOKIE];
  if (!token) return undefined;
  const resolved = await resolveSession(options.db, options.clock, options.session, token);
  if (resolved) {
    request.member = resolved.account;
    request.sessionId = resolved.sessionId;
    if (resolved.refreshed) reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(options, options.session.idleDays * 86_400));
  } else if (!isPublic) {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }
  const origin = request.headers.origin;
  if (UNSAFE.has(request.method) && origin !== undefined && origin !== options.publicOrigin) {
    return forbidden(reply, 'Requests from other sites are not accepted.');
  }
  return undefined;
}

/** The role-and-action rule for every route, then an Agent's hourly limits. */
async function authorize(request: FastifyRequest, reply: FastifyReply, options: AuthOptions) {
  const member = request.member;
  if (!member) return unauthorized(reply);
  const config = request.routeOptions.config;
  // Every route has an action (onRoute refuses one without at start-up). Only a request that
  // matches no route has none, and it is answered 404.
  const action = actionOf({ method: request.method, config });
  if (action !== null && !mayDo(member.role, action)) return forbidden(reply, refusal(member, action));
  if (member.role !== 'agent') return undefined;
  const kind = config?.agentLimit ?? 'read';
  const slot = await takeSlot(options.db, options.clock, member.id, kind);
  return slot.allowed ? undefined : tooManyRequests(reply, slot.retryAt, kind, options.clock.now());
}

function tooManyRequests(reply: FastifyReply, retryAt: Date, kind: LimitKind, now: Date) {
  const what = kind === 'proposal' ? 'Proposals' : kind === 'batch' ? 'requests to its Import batches' : 'requests';
  return reply
    .code(429)
    .header('retry-after', String(Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000))))
    .send({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `This Agent has reached its hourly limit of ${what}. Try again after ${retryAt.toISOString()}.`,
      code: 'rate_limited',
      retryAt: retryAt.toISOString(),
    });
}

export const auth = fp(authPlugin, { name: 'rodokmen-auth' });

/** Makes every route registered in this scope, and in the scopes inside it, public. */
export function publicScope(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    route.config = { ...route.config, public: true };
  });
}
