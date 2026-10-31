import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { messageOf } from './errors.js';

/**
 * The Content-Security-Policy of the app (issue #52), built from what it really loads:
 *
 * - scripts, styles, fonts, workers and the manifest only from the app's own origin, and no
 *   inline script or style at all (the app sets styles through the DOM, which a policy allows);
 * - images and fetches also from the image host, where presigned links point (files.<domain>
 *   in production; uploads are a PUT there), and from the map's tile and overlay hosts in
 *   app/data/layers.json (the service worker fetches tiles to keep them offline);
 * - `data:` images, for the blank tile Leaflet shows while a tile is cancelled, and `blob:`
 *   images, for the photos of a Draft shown before they are uploaded;
 * - nothing may frame the app, change its base URL, or receive its forms elsewhere.
 */
export function appContentSecurityPolicy(sources: { imageOrigin: string; mapSources: readonly string[] }): string {
  const remote = [...new Set([sources.imageOrigin, ...sources.mapSources])].join(' ');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: blob: ${remote}`,
    `connect-src 'self' ${remote}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * The policy source for a tile or map service URL template: its scheme and host. A `{s}`
 * subdomain placeholder becomes `*`. Null for anything else, which is then not allowed.
 */
export function sourceOfTemplate(template: string): string | null {
  const match = /^(https?):\/\/([^/?#]+)/i.exec(template);
  if (!match) return null;
  const host = match[2]!.replace(/^\{s\}\./, '*.').toLowerCase();
  if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/.test(host)) return null;
  return `${match[1]!.toLowerCase()}://${host}`;
}

const Layers = z.object({
  base: z.object({ url: z.string() }),
  overlays: z.array(z.object({ url: z.string() })),
});

/**
 * The hosts the map loads from, by app/data/layers.json: the base tiles and every overlay,
 * switched off or not (Settings, "Check map layers", asks each one).
 */
export function mapSources(layers: unknown): string[] {
  const parsed = Layers.parse(layers);
  const sources = [parsed.base.url, ...parsed.overlays.map((o) => o.url)].map(sourceOfTemplate);
  return [...new Set(sources.filter((s): s is string => s !== null))];
}

/** The map hosts of the app in `appDir`; none, with a message, when its layers.json cannot be read. */
export function readMapSources(appDir: string, log: (msg: string) => void): string[] {
  const file = `${appDir.replace(/\/$/, '')}/data/layers.json`;
  try {
    return mapSources(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    log(`Could not read the map layers in ${file} (${messageOf(error)}); the app's policy allows no map hosts.`);
    return [];
  }
}
