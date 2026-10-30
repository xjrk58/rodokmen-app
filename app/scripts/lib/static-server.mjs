// A minimal static file server for local use and tests. It serves a directory
// under a base path (GitHub Pages serves the app under /rodokmen-app/) and
// sends no-cache headers so every reload sees the files on disk.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * @param {{ root: string, port?: number, host?: string, base?: string }} options
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function startServer({ root: given, port = 0, host = '127.0.0.1', base = '/' }) {
  // Absolute, so the check that a file lies inside it also holds for a relative root such as ".".
  const root = resolve(given);
  const prefix = base.endsWith('/') ? base : `${base}/`;
  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  const answer = async (req, res) => {
    /** @type {string} */
    let path;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    try {
      if (path === prefix.slice(0, -1)) {
        res.writeHead(301, { location: prefix }).end();
        return;
      }
      if (!path.startsWith(prefix)) {
        res.writeHead(404).end('Not found');
        return;
      }
      let file = normalize(join(root, path.slice(prefix.length)));
      if (file !== root && !file.startsWith(root.endsWith(sep) ? root : root + sep)) {
        res.writeHead(403).end();
        return;
      }
      const info = await stat(file).catch(() => null);
      if (info?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file).catch(() => null);
      if (!body) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, {
        'content-type': /** @type {Record<string, string>} */ (MIME)[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  };
  const server = createServer((req, res) => void answer(req, res));
  await new Promise((resolve) => server.listen(port, host, () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    url: `http://${host}:${address.port}${prefix}`,
    port: address.port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
