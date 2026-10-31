import {
  ApiError,
  ChangeRoleBody,
  CreateInvitationBody,
  IdParams,
  InvitationList,
  InvitationView,
  LinkPersonBody,
  Me,
  MemberList,
  MemberView,
  PasskeyList,
  permissionsFor,
  RateLimited,
  SessionList,
  UpdateMeBody,
  type PersonSummary,
} from '@rodokmen/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  changeRole,
  createInvitation,
  disableMember,
  enableMember,
  keptPerson,
  linkPerson,
  listInvitations,
  listMembers,
  revokeInvitation,
  updateOwnAccount,
  type AccountDeps,
} from '../auth/accounts.js';
import { ApiProblem } from '../auth/problem.js';
import { endSession } from '../auth/sessions.js';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import type { Account } from '../db/types.js';
import { familyRootIds } from '../tree/relation.js';
import { personSummaries } from '../tree/summaries.js';

/** The linked Persons of these accounts, keyed by account id; a merged Person counts as the one it was merged into. */
async function linkedPersons(deps: { db: Db; clock: Clock }, accounts: readonly Account[]): Promise<Map<string, PersonSummary>> {
  const kept = new Map<string, string>();
  for (const a of accounts) {
    const id = a.person_id ? await keptPerson(deps.db, a.person_id) : null;
    if (id) kept.set(a.id, id);
  }
  const summaries = await personSummaries(deps.db, [...kept.values()], deps.clock);
  const out = new Map<string, PersonSummary>();
  for (const [accountId, personId] of kept) {
    const summary = summaries.get(personId);
    if (summary) out.set(accountId, summary);
  }
  return out;
}

export async function meView(deps: { db: Db; clock: Clock }, a: Account): Promise<Me> {
  const { n } = await deps.db
    .selectFrom('passkey')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('account_id', '=', a.id)
    .executeTakeFirstOrThrow();
  const persons = await linkedPersons(deps, [a]);
  return {
    id: a.id,
    version: a.version,
    email: a.email,
    displayName: a.display_name,
    language: a.language,
    role: a.role,
    permissions: permissionsFor(a.role),
    passkeyCount: n,
    person: persons.get(a.id) ?? null,
    familyRoots: await familyRootIds(deps.db),
  };
}

/** Members as the Owner sees them, each with their linked Person. Agents are listed with their tokens instead (auth/agents.ts). */
async function memberViews(deps: { db: Db; clock: Clock }, accounts: readonly Account[]): Promise<MemberView[]> {
  const persons = await linkedPersons(deps, accounts);
  return accounts.map((a) => {
    if (a.role === 'agent' || a.email === null) throw new Error(`account ${a.id} is an Agent, not a Member`);
    return {
      id: a.id,
      version: a.version,
      email: a.email,
      displayName: a.display_name,
      language: a.language,
      role: a.role,
      disabled: a.disabled_at !== null,
      createdAt: new Date(a.created_at).toISOString(),
      lastSeenAt: a.last_seen_at ? new Date(a.last_seen_at).toISOString() : null,
      person: persons.get(a.id) ?? null,
    };
  });
}

async function memberView(deps: { db: Db; clock: Clock }, a: Account): Promise<MemberView> {
  const [view] = await memberViews(deps, [a]);
  return view!;
}

const signedIn = { 401: ApiError, 429: RateLimited };
/** Members only: an Agent has no sessions, passkeys or email settings to manage. */
const ownAccount = { 401: ApiError, 403: ApiError };
const ownerOnly = { 401: ApiError, 403: ApiError };

/** The signed-in Member's own account, sessions and passkeys; the Owner's Member management. */
export async function accountRoutes(fastify: FastifyInstance, deps: AccountDeps) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const owner = { config: { action: 'manageAccounts' as const } };
  const own = { config: { action: 'ownAccount' as const } };

  app.get('/api/me', {
    schema: {
      tags: ['Account'],
      summary: 'The signed-in Member or Agent, with role, permissions and, for a Member, their own Person',
      response: { 200: Me, ...signedIn },
    },
    handler: async (req) => meView(deps, req.member!),
  });

  app.patch('/api/me', {
    ...own,
    schema: {
      tags: ['Account'],
      summary: 'Change your own display name or language (the language of the app and of emails)',
      body: UpdateMeBody,
      response: { 200: Me, 400: ApiError, ...ownAccount },
    },
    handler: async (req) => meView(deps, await updateOwnAccount(deps, req.member!, req.body)),
  });

  app.get('/api/me/sessions', {
    ...own,
    schema: { tags: ['Account'], summary: "The signed-in Member's open sessions", response: { 200: SessionList, ...ownAccount } },
    handler: async (req) => {
      const rows = await deps.db
        .selectFrom('session')
        .selectAll()
        .where('account_id', '=', req.member!.id)
        .where('ended_at', 'is', null)
        .where('expires_at', '>', deps.clock.now())
        .orderBy('last_seen_at', 'desc')
        .execute();
      return {
        items: rows.map((s) => ({
          id: s.id,
          createdAt: new Date(s.created_at).toISOString(),
          lastSeenAt: new Date(s.last_seen_at).toISOString(),
          expiresAt: new Date(s.expires_at).toISOString(),
          userAgent: s.user_agent,
          method: s.method,
          current: s.id === req.sessionId,
        })),
      };
    },
  });

  app.delete('/api/me/sessions/:id', {
    ...own,
    schema: { tags: ['Account'], summary: 'End one of your own sessions', params: IdParams, response: { 204: z.null(), 404: ApiError, ...ownAccount } },
    handler: async (req, reply) => {
      const s = await deps.db
        .selectFrom('session')
        .select('id')
        .where('id', '=', req.params.id)
        .where('account_id', '=', req.member!.id)
        .where('ended_at', 'is', null)
        .executeTakeFirst();
      if (!s) throw new ApiProblem(404, 'not_found', 'No open session of yours with this id.');
      await endSession(deps.db, deps.clock, s.id);
      return reply.code(204).send(null);
    },
  });

  app.get('/api/me/passkeys', {
    ...own,
    schema: { tags: ['Account'], summary: "The signed-in Member's passkeys", response: { 200: PasskeyList, ...ownAccount } },
    handler: async (req) => {
      const rows = await deps.db.selectFrom('passkey').selectAll().where('account_id', '=', req.member!.id).orderBy('created_at').execute();
      return {
        items: rows.map((k) => ({
          id: k.id,
          name: k.name,
          createdAt: new Date(k.created_at).toISOString(),
          lastUsedAt: k.last_used_at ? new Date(k.last_used_at).toISOString() : null,
          backedUp: k.backed_up,
        })),
      };
    },
  });

  app.delete('/api/me/passkeys/:id', {
    ...own,
    schema: { tags: ['Account'], summary: 'Remove one of your passkeys', params: IdParams, response: { 204: z.null(), 404: ApiError, ...ownAccount } },
    handler: async (req, reply) => {
      const r = await deps.db.deleteFrom('passkey').where('id', '=', req.params.id).where('account_id', '=', req.member!.id).executeTakeFirst();
      if (Number(r.numDeletedRows) === 0) throw new ApiProblem(404, 'not_found', 'No passkey of yours with this id.');
      return reply.code(204).send(null);
    },
  });

  // ---------------------------------------------------------------- Owner only

  app.get('/api/members', {
    ...owner,
    schema: { tags: ['Members'], summary: 'All Members (Owner only)', response: { 200: MemberList, ...ownerOnly } },
    handler: async () => ({ items: await memberViews(deps, await listMembers(deps)) }),
  });

  app.put('/api/members/:id/role', {
    ...owner,
    schema: {
      tags: ['Members'],
      summary: "Change a Member's role (Owner only). Making someone Owner hands ownership over",
      params: IdParams,
      body: ChangeRoleBody,
      response: { 200: MemberView, 404: ApiError, 409: ApiError, ...ownerOnly },
    },
    handler: async (req) => memberView(deps, await changeRole(deps, req.member!, req.params.id, req.body.role)),
  });

  app.post('/api/members/:id/disable', {
    ...owner,
    schema: {
      tags: ['Members'],
      summary: 'Disable a Member and end all their sessions (Owner only)',
      params: IdParams,
      response: { 200: MemberView, 404: ApiError, 409: ApiError, ...ownerOnly },
    },
    handler: async (req) => memberView(deps, await disableMember(deps, req.member!, req.params.id)),
  });

  app.post('/api/members/:id/enable', {
    ...owner,
    schema: {
      tags: ['Members'],
      summary: 'Enable a disabled Member again (Owner only)',
      params: IdParams,
      response: { 200: MemberView, 404: ApiError, ...ownerOnly },
    },
    handler: async (req) => memberView(deps, await enableMember(deps, req.params.id)),
  });

  app.put('/api/members/:id/person', {
    ...owner,
    schema: {
      tags: ['Members'],
      summary: 'Link a Member to the Person who is them in the Tree, or remove the link (Owner only). Their tree opens there',
      params: IdParams,
      body: LinkPersonBody,
      response: { 200: MemberView, 404: ApiError, ...ownerOnly },
    },
    handler: async (req) => memberView(deps, await linkPerson(deps, req.params.id, req.body.personId)),
  });

  app.get('/api/invitations', {
    ...owner,
    schema: { tags: ['Members'], summary: 'Invitations, newest first (Owner only)', response: { 200: InvitationList, ...ownerOnly } },
    handler: async () => ({ items: await listInvitations(deps) }),
  });

  app.post('/api/invitations', {
    ...owner,
    schema: {
      tags: ['Members'],
      summary: 'Invite a relative by email, in Czech or English (Owner only). The link works once for 7 days',
      body: CreateInvitationBody,
      response: { 201: InvitationView, 400: ApiError, 409: ApiError, ...ownerOnly },
    },
    handler: async (req, reply) => {
      reply.code(201);
      return createInvitation(deps, req.member!, req.body.email, req.body.language);
    },
  });

  app.delete('/api/invitations/:id', {
    ...owner,
    schema: {
      tags: ['Members'],
      summary: 'Withdraw an open invitation (Owner only)',
      params: IdParams,
      response: { 204: z.null(), 404: ApiError, ...ownerOnly },
    },
    handler: async (req, reply) => {
      await revokeInvitation(deps, req.params.id);
      return reply.code(204).send(null);
    },
  });
}
