import { CreatedInvitation, InvitationCheck, InvitationList } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_APP_DIR } from '../src/routes/pages.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { ensureOwner, makeApp, signIn, tokenFromEmail, type TestApp } from './helpers.js';

/**
 * A chat app fetches a link to show its preview (member-accounts spec, "Opening an invitation
 * link uses nothing up"). Over real HTTP, from a server that serves the app: the token is in the
 * fragment, which no HTTP client sends, so the server never receives it, and nothing a preview
 * can do uses the invitation up.
 */
describe('an invitation link in a chat', () => {
  let t: TestDatabase;
  let a: TestApp;
  let ownerCookie: string;
  let base: string;
  /** The request targets the HTTP server received, as they arrived on the wire. */
  const targets: string[] = [];

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t, { config: { APP_DIR: DEFAULT_APP_DIR } });
    ownerCookie = await signIn(t.db, a.clock, await ensureOwner(t.db));
    base = await a.app.listen({ port: 0, host: '127.0.0.1' });
    a.app.server.on('request', (req: { url?: string }) => targets.push(req.url ?? ''));
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  const invite = async (email: string) =>
    CreatedInvitation.parse(
      (await a.app.inject({ method: 'POST', url: '/api/invitations', headers: { cookie: ownerCookie }, payload: { email, language: 'en' } })).json(),
    );
  const post = async (path: string, body: object) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const statusOf = async (id: string) => {
    const list = await a.app.inject({ method: 'GET', url: '/api/invitations', headers: { cookie: ownerCookie } });
    return InvitationList.parse(list.json()).items.find((i) => i.id === id)!.status;
  };

  it('a link preview fetches only the app shell: the server never receives the token, and the invitation stays pending', async () => {
    const created = await invite('preview@example.test');
    const token = tokenFromEmail(created.link);
    const link = created.link.replace(a.config.publicOrigin, base);
    expect(link).toBe(`${base}/#invite/${token}`);

    targets.length = 0;
    // What a preview fetcher does: GET the link (and some a HEAD first), follow redirects, read the page.
    const head = await fetch(link, { method: 'HEAD', headers: { 'user-agent': 'WhatsApp/2.24.1.0 A' } });
    expect(head.status).toBe(200);
    const preview = await fetch(link, { headers: { 'user-agent': 'WhatsApp/2.24.1.0 A', accept: 'text/html' }, redirect: 'follow' });
    expect(preview.status).toBe(200);
    expect(preview.headers.get('referrer-policy')).toBe('no-referrer');
    const page = await preview.text();
    // The app shell, the same for every visitor: no token, nothing of the invitation.
    expect(page).toContain('<title>Rodokmen</title>');
    expect(page).not.toContain(token);
    expect(page).not.toContain('preview@example.test');
    expect(targets).toEqual(['/', '/']);
    expect(await statusOf(created.id)).toBe('pending');
  });

  it('a careless previewer that puts the token into the path or the query changes nothing either', async () => {
    const created = await invite('careless@example.test');
    const token = tokenFromEmail(created.link);
    for (const url of [
      `${base}/?invite=${token}`,
      `${base}/invite/${token}`,
      `${base}/%23invite/${token}`,
      `${base}/api/auth/invitation/check?token=${token}`,
    ]) {
      const res = await fetch(url, { headers: { 'user-agent': 'WhatsApp/2.24.1.0 A' } });
      // The app shell, a missing file, or an API route that is no sign-in step (401): never a page about the invitation.
      expect([200, 401, 403, 404], url).toContain(res.status);
      expect(await res.text(), url).not.toContain('careless@example.test');
    }
    expect(await statusOf(created.id)).toBe('pending');
  });

  it('opened twice: checking only reads, and only accepting with a display name uses the invitation', async () => {
    const created = await invite('twice@example.test');
    const token = tokenFromEmail(created.link);
    for (let i = 0; i < 2; i++) {
      const check = await post('/api/auth/invitation/check', { token });
      expect(check.status).toBe(200);
      expect(InvitationCheck.parse(await check.json())).toMatchObject({ status: 'pending', email: 'twice@example.test' });
    }
    expect(await statusOf(created.id)).toBe('pending');
    const accepted = await post('/api/auth/invitation/accept', { token, displayName: 'Twice', language: 'en' });
    expect(accepted.status).toBe(201);
    expect(await statusOf(created.id)).toBe('accepted');
  });
});
