// Proves that the checks of `pnpm check` (AGENTS.md, "Tools before agents") fire on the code that
// caused a real finding in #21, so a later change to their configuration cannot quietly turn them
// off. Each fixture reproduces the original bug; the code names the finding.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------- ESLint (eslint.config.mjs)

/**
 * A tracked file under `dir` ending in `suffix`. The fixture is linted in its place, so it gets
 * that file's configuration, type information included, without touching the working tree.
 */
function fileIn(dir, suffix) {
  const files = execFileSync('git', ['ls-files', dir], { cwd: ROOT, encoding: 'utf8' }).split('\n');
  const file = files.find((f) => f.endsWith(suffix));
  assert.ok(file, `no tracked ${suffix} file under ${dir}`);
  return file;
}

const eslint = new ESLint({ cwd: ROOT });

/** The findings of `rule` when `code` stands in for a file under `dir`. */
async function findings(code, dir, suffix, rule) {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, fileIn(dir, suffix)) });
  const fatal = result.messages.find((m) => m.fatal);
  assert.equal(fatal, undefined, fatal?.message);
  return result.messages.filter((m) => m.ruleId === rule).map((m) => m.message);
}

describe('ESLint restrictions', () => {
  test('sign-in hooks may not decide by the raw request.url (H1)', async () => {
    // The hook before 5a49ef8: GET /%61pi/persons/<id> reached /api/persons/:id without a session.
    const bug = `import type { FastifyInstance } from 'fastify';
export function guard(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/') && request.url !== '/api') return;
    if (request.raw.url === '/api') return;
  });
}
`;
    const found = await findings(bug, 'server/src/auth/', '.ts', 'no-restricted-syntax');
    assert.equal(found.length, 3);
    assert.match(found[0], /routeOptions/);
    const fixed = bug.replaceAll('request.url', 'request.routeOptions.url').replace('request.raw.url', 'request.routeOptions.url');
    assert.deepEqual(await findings(fixed, 'server/src/auth/', '.ts', 'no-restricted-syntax'), []);
    // Outside the sign-in hooks a route may use its URL (redirects keep the query, for one).
    assert.deepEqual(await findings(bug, 'server/src/routes/', '.ts', 'no-restricted-syntax'), []);
  });

  test('z.url() needs a protocol list (P2: Source links accepted javascript: and data:)', async () => {
    const bug = `import { z } from 'zod';\nexport const SourceLink = z.url().max(2000);\n`;
    const found = await findings(bug, 'shared/src/schemas/', '.ts', 'no-restricted-syntax');
    assert.equal(found.length, 1);
    assert.match(found[0], /WebUrl/);
    const fixed = bug.replace('z.url()', 'z.url({ protocol: /^https?$/ })');
    assert.deepEqual(await findings(fixed, 'shared/src/schemas/', '.ts', 'no-restricted-syntax'), []);
    assert.equal((await findings(bug, 'server/src/', '.ts', 'no-restricted-syntax')).length, 1);
  });

  test('the app may not take the UTC day for a local one (P2: readOn was yesterday after midnight)', async () => {
    // app/src/proposal-build.js before 6b9b605.
    const bug = `export const today = () => new Date().toISOString().slice(0, 10);\nexport const day = (d) => d.toISOString().split('T')[0];\n`;
    const found = await findings(bug, 'app/src/', '.js', 'no-restricted-syntax');
    assert.equal(found.length, 2);
    assert.match(found[0], /today\(\)/);
    // A timestamp is fine, and so is the UTC day where UTC is meant (the Living rule in shared/).
    assert.deepEqual(await findings(`export const now = () => new Date().toISOString();\n`, 'app/src/', '.js', 'no-restricted-syntax'), []);
    assert.deepEqual(await findings(`export const d = new Date().toISOString().slice(0, 10);\n`, 'shared/src/', '.ts', 'no-restricted-syntax'), []);
  });

  test('identifiers may not use words the glossary rejects (L23: town for a Place)', async () => {
    const bug = `export function label(place) {\n  const town = place.name;\n  return town;\n}\n`;
    // The declaration and its use.
    assert.equal((await findings(bug, 'app/src/', '.js', 'id-denylist')).length, 2);
    assert.deepEqual(await findings(bug.replaceAll('town', 'placeName'), 'app/src/', '.js', 'id-denylist'), []);
  });
});
