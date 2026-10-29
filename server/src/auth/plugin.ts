import { permissionsFor, type MemberRole } from '@rodokmen/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Db } from '../db/db.js';
import type { Account } from '../db/types.js';
import type { Clock } from '../tree/summaries.js';
import { resolveSession, SESSION_COOKIE, type SessionOptions } from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in Member, or null. Set for every /api request. */
    member: Account | null;
    sessionId: string | null;
  }
  interface FastifyContextConfig {
    /** Reachable without a session: the health check and the sign-in steps. */
    public?: boolean;
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

/**
 * Every /api request except the public ones needs a signed-in Member (tree-read-api spec,
 * "Members and Agents only"). The check runs in onRequest, before routing, validation and
 * any database lookup of the requested record, so a 401 reveals nothing about whether a
 * record exists. Unknown /api paths answer 401 too.
 *
 * Agent tokens (`Authorization: Bearer …`) arrive with add-agent-access; until then every
 * bearer token is refused.
 *
 * Writes authenticated by cookie must come from our own origin (defence in depth on top of
 * SameSite=Lax).
 */
async function authPlugin(app: FastifyInstance, options: AuthOptions) {
  app.decorateRequest('member', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/') && request.url !== '/api') return;
    const isPublic = request.routeOptions.config?.public === true;

    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const resolved = await resolveSession(options.db, options.clock, options.session, token);
      if (resolved) {
        request.member = resolved.account;
        request.sessionId = resolved.sessionId;
        if (resolved.refreshed) reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(options, options.session.idleDays * 86_400));
      } else if (!isPublic) {
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
      }
    }

    if (UNSAFE.has(request.method) && token) {
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== options.publicOrigin) {
        return forbidden(reply, 'Requests from other sites are not accepted.');
      }
    }

    if (isPublic || request.member) return;
    if (request.headers.authorization?.startsWith('Bearer ')) return unauthorized(reply, 'This token is not valid.');
    return unauthorized(reply);
  });
}

export const auth = fp(authPlugin, { name: 'rodokmen-auth' });

/** preHandler that refuses Members whose role is below the one needed. */
export function requireRole(role: MemberRole) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const member = request.member;
    if (!member) return unauthorized(reply);
    const allowed = role === 'owner' ? member.role === 'owner' : role === 'editor' ? permissionsFor(member.role).review : true;
    if (!allowed) return forbidden(reply, role === 'owner' ? 'Only the Owner can do this.' : 'Only Editors can do this.');
  };
}
