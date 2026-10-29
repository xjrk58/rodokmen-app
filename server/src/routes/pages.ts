import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { publicScope } from '../auth/plugin.js';

/** server/public, whether running from src/ (tsx) or dist/ (built). */
export const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
/** The map app at the repo root, used when APP_DIR is not set. */
export const DEFAULT_APP_DIR = fileURLToPath(new URL('../../../app/', import.meta.url));

const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/**
 * Serves the sign-in pages under /auth/ and the map app (`app/`, add-map-core) at /, from the
 * same origin as the API (ADR 0007). The app may be absent in a server-only checkout.
 */
export async function pageRoutes(app: FastifyInstance, options: { appDir: string | undefined; log: (msg: string) => void }) {
  // Pages and files are public; what they show comes from the API, which is not.
  publicScope(app);
  const authHtml = readFileSync(`${PUBLIC_DIR}auth/index.html`, 'utf8');

  await app.register(fastifyStatic, {
    root: `${PUBLIC_DIR}auth`,
    prefix: '/auth/',
    decorateReply: false,
    index: false,
    wildcard: false,
    allowedPath: (path) => path === '/auth.js' || path === '/auth.css',
    setHeaders: (res) => res.header('cache-control', 'no-cache'),
  });

  for (const page of ['/auth/invite', '/auth/link', '/auth/sign-in']) {
    app.get(page, { schema: { hide: true } }, async (_req, reply) =>
      reply.type('text/html; charset=utf-8').header('content-security-policy', PAGE_CSP).header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').send(authHtml),
    );
  }

  const appDir = options.appDir ?? DEFAULT_APP_DIR;
  if (existsSync(appDir) && statSync(appDir).isDirectory() && existsSync(`${appDir.replace(/\/$/, '')}/index.html`)) {
    await app.register(fastifyStatic, {
      root: appDir,
      prefix: '/',
      index: ['index.html'],
      // The service worker and the shell must revalidate so that new releases reach phones.
      cacheControl: false,
      setHeaders: (res, path) => res.header('cache-control', /(index\.html|sw\.js|manifest\.webmanifest)$/.test(path) ? 'no-cache' : 'public, max-age=3600'),
      allowedPath: (path) => !path.startsWith('/api/') && !path.startsWith('/auth/'),
    });
  } else {
    options.log(`No map app at ${appDir}; serving a placeholder at /.`);
    app.get('/', { schema: { hide: true } }, async (_req, reply) =>
      reply
        .type('text/html; charset=utf-8')
        .header('content-security-policy', PAGE_CSP)
        .send('<!doctype html><html lang="en"><meta charset="utf-8"><title>Rodokmen</title><p>Rodokmen is running. The map app is not part of this build.</p><p><a href="/auth/sign-in">Sign in</a></p></html>'),
    );
  }
}
