/**
 * Member accounts (member-accounts spec): invitations, sign-in, roles and sessions; and Agent
 * accounts with their tokens (agent-access spec).
 */
import { z } from 'zod';
import { mayDecide, mayDo } from '../rules.js';
import { PersonSummary } from './api.js';
import { ApiError, Id, UiLanguage, Version } from './common.js';

/** Every Member has exactly one role. There is exactly one Owner. */
export const MemberRole = z.enum(['contributor', 'editor', 'owner']).meta({ id: 'MemberRole', description: 'Contributor (the default), Editor or Owner' });

export const MEMBER_ROLE_RANK = { contributor: 0, editor: 1, owner: 2 } as const satisfies Record<z.infer<typeof MemberRole>, number>;

/** The role of any account: a Member's, or `agent` for an Agent the Owner created (agent-access spec). */
export const AccountRole = z
  .enum(['contributor', 'editor', 'owner', 'agent'])
  .meta({ id: 'AccountRole', description: 'A Member role, or agent for an Agent account (read, propose and write Research leads only)' });

/**
 * What an API route does, as the role-and-action rule `mayDo` (shared/src/rules.ts) sees it.
 * Every route names one (server/src/auth/plugin.ts); a GET that names none reads.
 */
export const ACTIONS = [
  'read',
  'propose',
  'writeLeads',
  'decideSuggestions',
  'review',
  'accept',
  'reject',
  'merge',
  'undo',
  'directEdit',
  'ownAccount',
  'manageAccounts',
  'markFamilyRoots',
  'acceptBatch',
] as const;
export type Action = (typeof ACTIONS)[number];

/** What a role allows, from the role-and-action rule. Editors and the Owner review Proposals; only the Owner manages Members and Agents. */
export function permissionsFor(role: z.infer<typeof AccountRole>) {
  return {
    propose: mayDo(role, 'propose'),
    writeLeads: mayDo(role, 'writeLeads'),
    decideSuggestions: mayDo(role, 'decideSuggestions'),
    review: mayDecide(role),
    inviteMembers: mayDo(role, 'manageAccounts'),
    changeRoles: mayDo(role, 'manageAccounts'),
    disableMembers: mayDo(role, 'manageAccounts'),
    markFamilyRoots: mayDo(role, 'markFamilyRoots'),
    acceptBatch: mayDo(role, 'acceptBatch'),
  };
}

export const Permissions = z
  .object({
    propose: z.boolean(),
    writeLeads: z.boolean().describe('Write Research leads and search records (Members and Agents)'),
    decideSuggestions: z.boolean().describe('Accept or dismiss a suggested lead (Members)'),
    review: z.boolean(),
    inviteMembers: z.boolean(),
    changeRoles: z.boolean(),
    disableMembers: z.boolean(),
    markFamilyRoots: z.boolean().describe('Mark and unmark Family roots (the Owner)'),
    acceptBatch: z.boolean().describe('Accept a whole Import batch at once (the Owner)'),
  })
  .meta({ id: 'Permissions' });

export const DisplayName = z.string().trim().min(1).max(100);
export const Email = z.email().max(320);

export const Me = z
  .object({
    id: Id,
    version: Version,
    email: z.string().nullable().describe('Null for an Agent, which has no email'),
    displayName: z.string(),
    language: UiLanguage,
    role: AccountRole,
    permissions: Permissions,
    passkeyCount: z.number().int(),
    person: PersonSummary.nullable().describe('The Person who is this Member in the Tree, linked by the Owner; shown to this Member alone (and to the Owner)'),
    familyRoots: z
      .array(Id)
      .describe('The Family roots the Owner marked, the first marked first. Empty until the first one: until then the relation to the family says nothing'),
  })
  .meta({ id: 'Me' });

export const UpdateMeBody = z
  .object({ displayName: DisplayName.optional(), language: UiLanguage.optional() })
  .refine((b) => b.displayName !== undefined || b.language !== undefined, { message: 'Give displayName, language or both' })
  .meta({ id: 'UpdateMeBody', description: 'Change your own display name or language (the language of the app and of emails)' });

export const MemberView = z
  .object({
    id: Id,
    version: Version,
    email: z.string(),
    displayName: z.string(),
    language: UiLanguage,
    role: MemberRole,
    disabled: z.boolean(),
    createdAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime().nullable(),
    person: PersonSummary.nullable().describe('The Person who is this Member in the Tree, when the Owner has linked one'),
  })
  .meta({ id: 'MemberView' });

export const MemberList = z.object({ items: z.array(MemberView) }).meta({ id: 'MemberList' });

export const LinkPersonBody = z
  .object({ personId: Id.nullable().describe('The Person who is this Member in the Tree; null removes the link') })
  .meta({ id: 'LinkPersonBody' });

export const ChangeRoleBody = z
  .object({ role: MemberRole })
  .meta({ id: 'ChangeRoleBody', description: 'Making another Member the Owner hands over ownership: the current Owner becomes an Editor' });

export const SessionView = z
  .object({
    id: Id,
    createdAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    userAgent: z.string().nullable(),
    method: z.enum(['passkey', 'email_link', 'invitation']),
    current: z.boolean(),
  })
  .meta({ id: 'SessionView' });

export const SessionList = z.object({ items: z.array(SessionView) }).meta({ id: 'SessionList' });

export const PasskeyView = z
  .object({
    id: Id,
    name: z.string(),
    createdAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime().nullable(),
    backedUp: z.boolean(),
  })
  .meta({ id: 'PasskeyView' });

export const PasskeyList = z.object({ items: z.array(PasskeyView) }).meta({ id: 'PasskeyList' });

// ---------------------------------------------------------------- invitations

export const INVITATION_DAYS = 7;
export const SIGN_IN_LINK_MINUTES = 15;

export const CreateInvitationBody = z.object({ email: Email, language: UiLanguage }).meta({ id: 'CreateInvitationBody' });

export const InvitationStatus = z.enum(['pending', 'accepted', 'expired', 'revoked']).meta({ id: 'InvitationStatus' });

export const InvitationView = z
  .object({
    id: Id,
    email: z.string(),
    language: UiLanguage,
    status: InvitationStatus,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    acceptedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'InvitationView' });

export const InvitationList = z.object({ items: z.array(InvitationView) }).meta({ id: 'InvitationList' });

export const TokenBody = z.object({ token: z.string().min(20).max(200) });

/** What an invited relative sees before accepting. */
export const InvitationCheck = z
  .object({
    status: InvitationStatus,
    language: UiLanguage,
    message: z.string().describe('What to do next, in the invitation language'),
  })
  .meta({ id: 'InvitationCheck' });

export const AcceptInvitationBody = z
  .object({ token: z.string().min(20).max(200), displayName: DisplayName, language: UiLanguage })
  .meta({ id: 'AcceptInvitationBody' });

// ---------------------------------------------------------------- sign-in

export const EmailLinkRequestBody = z.object({ email: Email }).meta({ id: 'EmailLinkRequestBody' });

export const Accepted = z.object({ ok: z.literal(true), message: z.string() }).meta({ id: 'Accepted' });

/** WebAuthn options and responses are passed through as JSON (see @simplewebauthn). */
export const WebAuthnJson = z.record(z.string(), z.unknown()).meta({ id: 'WebAuthnJson' });

export const PasskeyRegistrationVerifyBody = z
  .object({ response: WebAuthnJson, name: z.string().trim().min(1).max(100).optional() })
  .meta({ id: 'PasskeyRegistrationVerifyBody' });

export const PasskeyLoginVerifyBody = z.object({ response: WebAuthnJson }).meta({ id: 'PasskeyLoginVerifyBody' });

export const SignedIn = z.object({ ok: z.literal(true), member: Me }).meta({ id: 'SignedIn' });

// ---------------------------------------------------------------- Agents (agent-access spec)

/** Agent token prefix: `rdk_ag_` and 64 hex digits (256 random bits). */
export const AGENT_TOKEN_PATTERN = /^rdk_ag_[0-9a-f]{64}$/;
/** Requests an Agent may make per hour (agent-access spec, "Rate limits"). */
export const AGENT_PROPOSALS_PER_HOUR = 60;
export const AGENT_READS_PER_HOUR = 1000;
/** Requests an Agent may make to its Import batches per hour (agent-access spec, "Import batches have their own limit"). */
export const AGENT_BATCH_REQUESTS_PER_HOUR = 10_000;

export const AgentName = z.string().trim().min(1).max(100);

const TokenLabel = z.string().trim().min(1).max(100).describe('What the token is for, such as the machine it runs on');

export const CreateAgentBody = z
  .object({ name: AgentName.describe("The Agent's name, shown next to its Proposals"), tokenLabel: TokenLabel.optional() })
  .meta({ id: 'CreateAgentBody' });

export const CreateAgentTokenBody = z.object({ label: TokenLabel.optional() }).meta({ id: 'CreateAgentTokenBody' });

export const AgentTokenView = z
  .object({
    id: Id,
    prefix: z.string().describe('The first characters of the token, to tell tokens apart'),
    label: z.string().nullable(),
    createdAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime().nullable(),
    revokedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'AgentTokenView' });

export const IssuedAgentToken = AgentTokenView.safeExtend({
  token: z.string().describe('The whole token. It is shown only in this answer; only its hash is stored'),
}).meta({ id: 'IssuedAgentToken' });

export const WindowUsage = z
  .object({
    count: z.number().int().describe('Requests counted in the current window'),
    limit: z.number().int().describe('Requests allowed per window'),
    windowEndsAt: z.iso.datetime().nullable().describe('End of the current window; null when none is open'),
  })
  .meta({ id: 'WindowUsage' });

export const AgentUsage = z
  .object({
    proposals: WindowUsage.describe('Submitted Proposals, per hour'),
    reads: WindowUsage.describe('Every other request (reads, and image uploads for Proposals), per hour'),
  })
  .meta({ id: 'AgentUsage' });

export const AgentView = z
  .object({
    id: Id,
    name: z.string(),
    disabled: z.boolean(),
    createdAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime().nullable(),
    tokens: z.array(AgentTokenView).describe('Newest first, revoked ones included'),
    usage: AgentUsage,
  })
  .meta({ id: 'AgentView' });

export const AgentList = z.object({ items: z.array(AgentView) }).meta({ id: 'AgentList' });

export const CreatedAgent = z
  .object({ agent: AgentView, token: IssuedAgentToken.describe("The Agent's first token, shown in full only here") })
  .meta({ id: 'CreatedAgent' });

export const AgentTokenParams = z.object({ id: Id, tokenId: Id });

/** 429: an Agent over its hourly limit, with the time after which it may try again. */
export const RateLimited = ApiError.safeExtend({
  retryAt: z.iso.datetime().describe('When the current window ends and the request may be made again'),
}).meta({ id: 'RateLimited' });

export type MemberRole = z.infer<typeof MemberRole>;
export type AccountRole = z.infer<typeof AccountRole>;
export type AgentView = z.infer<typeof AgentView>;
export type AgentTokenView = z.infer<typeof AgentTokenView>;
export type IssuedAgentToken = z.infer<typeof IssuedAgentToken>;
export type Me = z.infer<typeof Me>;
export type MemberView = z.infer<typeof MemberView>;
export type UpdateMeBody = z.infer<typeof UpdateMeBody>;
export type SessionView = z.infer<typeof SessionView>;
export type InvitationView = z.infer<typeof InvitationView>;
export type InvitationStatus = z.infer<typeof InvitationStatus>;
