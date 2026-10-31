import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { publicScope } from '../auth/plugin.js';

/** The map app at the repo root, used when APP_DIR is not set. */
export const DEFAULT_APP_DIR = fileURLToPath(new URL('../../../app/', import.meta.url));

const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/**
 * Serves the app (`app/`) at /, from the same origin as the API (ADR 0007). Signing in happens
 * in the app (`#sign-in`, `#invite/<token>`, `#link/<token>`; add-family-view). The app may be
 * absent in a server-only checkout.
 */
export async function pageRoutes(app: FastifyInstance, options: { appDir: string | undefined; log: (msg: string) => void }) {
  // Pages and files are public; what they show comes from the API, which is not.
  publicScope(app);

  const appDir = options.appDir ?? DEFAULT_APP_DIR;
  if (existsSync(appDir) && statSync(appDir).isDirectory() && existsSync(`${appDir.replace(/\/$/, '')}/index.html`)) {
    await app.register(fastifyStatic, {
      root: appDir,
      prefix: '/',
      index: ['index.html'],
      // The service worker and the shell must revalidate so that new releases reach phones.
      cacheControl: false,
      setHeaders: (res, path) => {
        res.header('cache-control', /(index\.html|sw\.js|manifest\.webmanifest)$/.test(path) ? 'no-cache' : 'public, max-age=3600');
      },
      allowedPath: (path) => !path.startsWith('/api/'),
    });
  } else {
    options.log(`No map app at ${appDir}; serving a placeholder at /.`);
    app.get('/', { schema: { hide: true } }, async (_req, reply) =>
      reply
        .type('text/html; charset=utf-8')
        .header('content-security-policy', PAGE_CSP)
        .send(
          '<!doctype html><html lang="en"><meta charset="utf-8"><title>Rodokmen</title><p>Rodokmen is running. The app is not part of this build.</p></html>',
        ),
    );
  }
}
