import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { z } from 'zod';

/**
 * The production stack's files in deploy/, for tests that check them against the servers' own
 * settings: what Caddy and Docker do has to fit what the API and the MCP server do.
 */
const read = (path: string) => readFileSync(new URL(`../../deploy/${path}`, import.meta.url), 'utf8');

/** deploy/caddy/Caddyfile without its comments. */
export const caddyfile = (): string => read('caddy/Caddyfile').replace(/(^|\s)#.*$/gm, '$1');

/** The inside of the first Caddyfile block that opens with `opening {`, such as `(api-slot)` or `handle @mcp`. */
export function caddyBlock(opening: string): string {
  const text = caddyfile();
  const head = text.indexOf(`${opening} {`);
  if (head < 0) throw new Error(`the Caddyfile has no block "${opening}"`);
  const start = text.indexOf('{', head + opening.length);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start + 1, i);
  }
  throw new Error(`the Caddyfile block "${opening}" does not end`);
}

/** The value of a setting written `name value` on a line of its own in a Caddyfile block. */
export function caddySetting(block: string, name: string): string | undefined {
  return new RegExp(`^\\s*${name}\\s+(\\S+)\\s*$`, 'm').exec(block)?.[1];
}

/** A Caddy or Compose duration such as `250ms`, `60s` or `2m`, in milliseconds. */
export function durationMs(value: string | undefined): number {
  const match = /^(\d+)(ms|s|m)$/.exec(value ?? '');
  if (!match) throw new Error(`not a duration: ${value}`);
  return Number(match[1]) * (match[2] === 'ms' ? 1 : match[2] === 's' ? 1000 : 60_000);
}

const Compose = z.object({ services: z.record(z.string(), z.record(z.string(), z.unknown())) });

/** A setting of a service in deploy/docker-compose.yml. */
export function composeSetting(service: string, key: string): unknown {
  return Compose.parse(YAML.parse(read('docker-compose.yml'), { merge: true })).services[service]?.[key];
}
