/**
 * Member accounts (member-accounts spec): invitations, sign-in, roles and sessions.
 */
import { z } from 'zod';
import { mayDecide } from '../rules.js';
import { Id, UiLanguage, Version } from './common.js';

/** Every Member has exactly one role. There is exactly one Owner. */
export const MemberRole = z
  .enum(['contributor', 'editor', 'owner'])
  .meta({ id: 'MemberRole', description: 'Contributor (the default), Editor or Owner' });

export const MEMBER_ROLE_RANK = { contributor: 0, editor: 1, owner: 2 } as const satisfies Record<z.infer<typeof MemberRole>, number>;

/** What a role allows. Editors and the Owner review Proposals; only the Owner manages Members. */
export function permissionsFor(role: z.infer<typeof MemberRole>) {
  return {
    propose: true,
    review: mayDecide(role),
    inviteMembers: role === 'owner',
    changeRoles: role === 'owner',
    disableMembers: role === 'owner',
  };
}

export const Permissions = z
  .object({
    propose: z.boolean(),
    review: z.boolean(),
    inviteMembers: z.boolean(),
    changeRoles: z.boolean(),
    disableMembers: z.boolean(),
  })
  .meta({ id: 'Permissions' });

export const DisplayName = z.string().trim().min(1).max(100);
export const Email = z.email().max(320);

export const Me = z
  .object({
    id: Id,
    version: Version,
    email: z.string(),
    displayName: z.string(),
    language: UiLanguage,
    role: MemberRole,
    permissions: Permissions,
    passkeyCount: z.number().int(),
  })
  .meta({ id: 'Me' });

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
  })
  .meta({ id: 'MemberView' });

export const MemberList = z.object({ items: z.array(MemberView) }).meta({ id: 'MemberList' });

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

export const CreateInvitationBody = z
  .object({ email: Email, language: UiLanguage })
  .meta({ id: 'CreateInvitationBody' });

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

export type MemberRole = z.infer<typeof MemberRole>;
export type Me = z.infer<typeof Me>;
export type MemberView = z.infer<typeof MemberView>;
export type SessionView = z.infer<typeof SessionView>;
export type InvitationView = z.infer<typeof InvitationView>;
export type InvitationStatus = z.infer<typeof InvitationStatus>;
