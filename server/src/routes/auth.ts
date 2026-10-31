import {
  AcceptInvitationBody,
  Accepted,
  ApiError,
  EmailLinkRequestBody,
  InvitationCheck,
  PasskeyLoginVerifyBody,
  PasskeyRegistrationVerifyBody,
  SignedIn,
  TokenBody,
  WebAuthnJson,
} from '@rodokmen/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { acceptInvitation, checkInvitation, consumeEmailLink, requestEmailLink, type AccountDeps } from '../auth/accounts.js';
import {
  authenticationOptions,
  CHALLENGE_COOKIE,
  CHALLENGE_SECONDS,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
  type PasskeyDeps,
} from '../auth/passkeys.js';
import { sessionCookieOptions, unauthorized } from '../auth/plugin.js';
import { createSession, endSession, SESSION_COOKIE } from '../auth/sessions.js';
import type { Account } from '../db/types.js';
import { meView } from './accounts.js';

export interface AuthRouteDeps extends AccountDeps {
  passkeys: PasskeyDeps;
  cookieSecure: boolean;
}

const challengeCookie = (secure: boolean) => ({ path: '/api/auth/passkey', httpOnly: true, secure, sameSite: 'strict' as const, maxAge: CHALLENGE_SECONDS });

/**
 * Sign-in (member-accounts spec): accepting an invitation, passkeys, and emailed links. These
 * routes are public: they are how a Member gets a session. There is no public sign-up.
 */
export async function authRoutes(fastify: FastifyInstance, deps: AuthRouteDeps) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const pub = { public: true };

  const signIn = async (reply: FastifyReply, account: Account, session: { token: string }) => {
    reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(deps, deps.session.idleDays * 86_400));
    return { ok: true as const, member: await meView(deps.db, account) };
  };

  app.post('/api/auth/invitation/check', {
    config: pub,
    schema: {
      tags: ['Sign-in'],
      summary: 'Whether an invitation link is still valid, and what to tell the relative',
      body: TokenBody,
      response: { 200: InvitationCheck, 404: ApiError },
    },
    handler: async (req) => checkInvitation(deps, req.body.token),
  });

  app.post('/api/auth/invitation/accept', {
    config: pub,
    schema: {
      tags: ['Sign-in'],
      summary: 'Accept an invitation: set display name and language, become a Contributor and sign in',
      body: AcceptInvitationBody,
      response: { 201: SignedIn, 404: ApiError, 409: ApiError, 410: ApiError },
    },
    handler: async (req, reply) => {
      const { account, session } = await acceptInvitation(deps, req.body.token, req.body.displayName, req.body.language, req.headers['user-agent']);
      reply.code(201);
      return signIn(reply, account, session);
    },
  });

  app.post('/api/auth/email-link', {
    config: pub,
    schema: {
      tags: ['Sign-in'],
      summary: 'Email a sign-in link (valid once, for 15 minutes). The answer is the same for unknown addresses',
      body: EmailLinkRequestBody,
      response: { 202: Accepted, 400: ApiError },
    },
    handler: async (req, reply) => {
      await requestEmailLink(deps, req.body.email);
      reply.code(202);
      return { ok: true as const, message: 'If this address belongs to a Member, a sign-in link is on its way.' };
    },
  });

  app.post('/api/auth/email-link/verify', {
    config: pub,
    schema: { tags: ['Sign-in'], summary: 'Sign in with the token from an emailed link', body: TokenBody, response: { 200: SignedIn, 410: ApiError } },
    handler: async (req, reply) => {
      const { account, session } = await consumeEmailLink(deps, req.body.token, req.headers['user-agent']);
      return signIn(reply, account, session);
    },
  });

  app.post('/api/auth/passkey/authentication/options', {
    config: pub,
    schema: { tags: ['Sign-in'], summary: 'Start signing in with a passkey', response: { 200: WebAuthnJson } },
    handler: async (_req, reply) => {
      const { options, challengeId } = await authenticationOptions(deps.passkeys);
      reply.setCookie(CHALLENGE_COOKIE, challengeId, challengeCookie(deps.cookieSecure));
      return { ...options };
    },
  });

  app.post('/api/auth/passkey/authentication/verify', {
    config: pub,
    schema: {
      tags: ['Sign-in'],
      summary: 'Finish signing in with a passkey',
      body: PasskeyLoginVerifyBody,
      response: { 200: SignedIn, 400: ApiError, 401: ApiError },
    },
    handler: async (req, reply) => {
      const account = await verifyAuthentication(deps.passkeys, req.cookies[CHALLENGE_COOKIE], req.body.response);
      reply.clearCookie(CHALLENGE_COOKIE, { path: '/api/auth/passkey' });
      const session = await createSession(deps.db, deps.clock, deps.session, account.id, 'passkey', req.headers['user-agent']);
      return signIn(reply, account, session);
    },
  });

  // Registering a passkey needs a session: from an invitation, an emailed link, or another passkey.
  app.post('/api/auth/passkey/registration/options', {
    config: { action: 'ownAccount' },
    schema: { tags: ['Sign-in'], summary: 'Start registering a passkey on this device', response: { 200: WebAuthnJson, 401: ApiError, 403: ApiError } },
    handler: async (req, reply) => {
      if (!req.member) return unauthorized(reply);
      const { options, challengeId } = await registrationOptions(deps.passkeys, req.member);
      reply.setCookie(CHALLENGE_COOKIE, challengeId, challengeCookie(deps.cookieSecure));
      return { ...options };
    },
  });

  app.post('/api/auth/passkey/registration/verify', {
    config: { action: 'ownAccount' },
    schema: {
      tags: ['Sign-in'],
      summary: 'Finish registering a passkey',
      body: PasskeyRegistrationVerifyBody,
      response: { 201: z.object({ id: z.uuid() }), 400: ApiError, 401: ApiError, 403: ApiError, 409: ApiError },
    },
    handler: async (req, reply) => {
      if (!req.member) return unauthorized(reply);
      const id = await verifyRegistration(deps.passkeys, req.member, req.cookies[CHALLENGE_COOKIE], req.body.response, req.body.name);
      reply.clearCookie(CHALLENGE_COOKIE, { path: '/api/auth/passkey' });
      reply.code(201);
      return { id };
    },
  });

  app.post('/api/auth/sign-out', {
    config: pub,
    schema: { tags: ['Sign-in'], summary: 'End the current session', response: { 204: z.null() } },
    handler: async (req, reply) => {
      if (req.sessionId) await endSession(deps.db, deps.clock, req.sessionId);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(204).send(null);
    },
  });
}
