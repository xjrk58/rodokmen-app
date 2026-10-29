#!/usr/bin/env node
// Checks that every archive portal URL in app/data/archives.json still answers.
// Exits 1 and names the archive and URL of every failure. Run weekly by
// .github/workflows/archive-links.yml.
//
// Usage: node scripts/check-links.mjs [--file path/to/archives.json]
//          [--extra "Name=https://url"]... [--timeout ms] [--retries n]
// --extra adds a URL to the check, for a test run with a deliberately broken URL.
// Behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1.

import { appendFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const USER_AGENT = 'rodokmen-link-check/1 (+https://github.com/xjrk58/rodokmen-app)';
const SAMPLE_PLACE = 'Pardubice';

/**
 * @typedef {{ archive: string, kind: string, url: string }} Target
 * @typedef {Target & { ok: boolean, status: string }} Result
 */

/**
 * @param {any} data parsed archives.json
 * @returns {Target[]}
 */
export function targetsOf(data) {
  /** @type {Target[]} */
  const targets = [];
  for (const entry of [...(data.archives ?? []), ...(data.jewishRegisters ? [data.jewishRegisters] : [])]) {
    targets.push({ archive: entry.name, kind: `portal ${entry.portal?.name ?? ''}`.trim(), url: entry.portal?.url });
    if (entry.placeSearchUrl) {
      targets.push({ archive: entry.name, kind: 'place search', url: entry.placeSearchUrl.replaceAll('{name}', encodeURIComponent(SAMPLE_PLACE)) });
    }
  }
  return targets;
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, status: string, retry: boolean }>}
 */
async function probe(url, timeoutMs) {
  try {
    // GET, not HEAD: several portals answer HEAD with an error.
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    return { ok: response.status < 400, status: `HTTP ${response.status}`, retry: response.status >= 500 || response.status === 429 };
  } catch (error) {
    const cause = /** @type {any} */ (error)?.cause;
    const message = /** @type {Error} */ (error).name === 'TimeoutError' ? `no answer within ${timeoutMs} ms` : (cause?.code ?? cause?.message ?? String(error));
    return { ok: false, status: message, retry: true };
  }
}

/**
 * @param {Target} target
 * @param {{ timeoutMs: number, retries: number }} options
 * @returns {Promise<Result>}
 */
async function check(target, { timeoutMs, retries }) {
  if (typeof target.url !== 'string' || !/^https?:\/\//.test(target.url)) return { ...target, ok: false, status: 'not a URL' };
  let result = await probe(target.url, timeoutMs);
  for (let attempt = 1; !result.ok && result.retry && attempt <= retries; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    result = await probe(target.url, timeoutMs);
  }
  return { ...target, ok: result.ok, status: result.status };
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      file: { type: 'string', default: join(appDir, 'data', 'archives.json') },
      extra: { type: 'string', multiple: true, default: [] },
      timeout: { type: 'string', default: '20000' },
      retries: { type: 'string', default: '2' },
    },
  });
  const data = JSON.parse(await readFile(args.file, 'utf8'));
  const targets = targetsOf(data);
  for (const extra of args.extra) {
    const at = extra.indexOf('=');
    targets.push({ archive: at > 0 ? extra.slice(0, at) : 'extra', kind: 'extra', url: at > 0 ? extra.slice(at + 1) : extra });
  }
  const options = { timeoutMs: Number(args.timeout), retries: Number(args.retries) };
  const results = await Promise.all(targets.map((t) => check(t, options)));
  const failed = results.filter((r) => !r.ok);

  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.archive} (${r.kind}): ${r.url} - ${r.status}`);
  if (process.env.GITHUB_ACTIONS) {
    for (const r of failed) console.log(`::error title=Archive link broken::${r.archive} (${r.kind}): ${r.url} - ${r.status}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map((r) => `| ${r.ok ? '✅' : '❌'} | ${r.archive} | ${r.kind} | ${r.url} | ${r.status} |`);
    await appendFile(process.env.GITHUB_STEP_SUMMARY, ['## Archive portal links', '', '| | Archive | Link | URL | Result |', '|---|---|---|---|---|', ...rows, ''].join('\n'));
  }
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} archive links failed:`);
    for (const r of failed) console.error(`  ${r.archive}: ${r.url} (${r.status})`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} archive links answer.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
