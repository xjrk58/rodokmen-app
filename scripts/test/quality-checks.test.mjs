// Proves that the checks of `pnpm check` (AGENTS.md, "Tools before agents") fire on the code that
// caused a real finding in #21, so a later change to their configuration cannot quietly turn them
// off. Each fixture reproduces the original bug; the code names the finding.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKSPACES = ['.', 'app', 'server', 'server/mcp', 'shared'];

/**
 * A copy of the working tree (tracked files and new ones git does not ignore) in a temporary folder,
 * sharing node_modules, for tools that read files from disk. Removed after the test.
 */
function copyOfRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'quality-checks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  for (const file of files) if (existsSync(join(ROOT, file))) cpSync(join(ROOT, file), join(dir, file));
  for (const ws of WORKSPACES) symlinkSync(join(ROOT, ws, 'node_modules'), join(dir, ws, 'node_modules'));
  return dir;
}

/** Replaces `old`, which must occur once, in a file of the copy. */
function change(dir, file, old, replacement) {
  const text = readFileSync(join(dir, file), 'utf8');
  assert.equal(text.split(old).length, 2, `${old} not found once in ${file}`);
  writeFileSync(join(dir, file), text.replace(old, replacement));
}

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

  test('browser tests may not wait a fixed time (L18)', async () => {
    const app = `import { test } from '@playwright/test';\ntest('stops', async ({ page }) => {\n  await page.goto('./');\n  await page.waitForTimeout(1500);\n});\n`;
    assert.equal((await findings(app, 'app/tests/e2e/', '.spec.js', 'playwright/no-wait-for-timeout')).length, 1);
    const server = `import { chromium } from 'playwright';\nimport { it } from 'vitest';\nit('shows', async () => {\n  const page = await (await chromium.launch()).newPage();\n  await page.waitForTimeout(700);\n});\n`;
    assert.equal((await findings(server, 'server/test/', '.e2e.test.ts', 'playwright/no-wait-for-timeout')).length, 1);
  });
});

// ---------------------------------------------------------------- knip (knip.jsonc)

describe('knip', () => {
  test('finds an export nobody uses (M11) and an unused class member (#22: TileLru.has)', (t) => {
    const dir = copyOfRepo(t);
    // M11: ImageQuery was exported from shared's schemas and used nowhere.
    change(
      dir,
      'shared/src/schemas/api.ts',
      '\nexport const ImageView',
      '\nexport const ImageQuery = z.object({ full: z.boolean().optional() });\n\nexport const ImageView',
    );
    // The app's dead members: TileLru.has was never called.
    change(dir, 'app/src/tile-lru.js', '  get size() {', '  /** @param {string} key */\n  has(key) {\n    return this.order.has(key);\n  }\n\n  get size() {');
    const run = spawnSync(process.execPath, [join(ROOT, 'node_modules/knip/bin/knip.js'), '--no-progress', '--reporter', 'json'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(run.status, 1, run.stderr);
    const { issues } = JSON.parse(run.stdout);
    const of = (file) => issues.find((i) => i.file === file) ?? {};
    assert.deepEqual(
      of('shared/src/schemas/api.ts').exports?.map((e) => e.name),
      ['ImageQuery'],
    );
    assert.deepEqual(
      Object.values(of('app/src/tile-lru.js').classMembers ?? {}).flatMap((members) => members.map((m) => m.name)),
      ['has'],
    );
  });
});

// ---------------------------------------------------------------- dependency-cruiser (.dependency-cruiser.cjs)

describe('dependency-cruiser', () => {
  test('refuses app → server and sign-in → Tree imports (M5), and a baseline entry that no longer occurs', (t) => {
    const dir = copyOfRepo(t);
    change(
      dir,
      'app/src/api.js',
      "import { hex } from './text.js';",
      "import { hex } from './text.js';\nimport { systemClock } from '../../server/src/clock.js';",
    );
    // M5: the Clock sat in a Tree module that sign-in, storage and ops imported.
    change(dir, 'server/src/auth/sessions.ts', "import type { Clock } from '../clock.js';", "import type { Clock } from '../tree/persons.js';");
    // A known cycle fixed (db.ts → types.ts → records.ts → db.ts): its baseline entry is stale now.
    change(dir, 'server/src/db/types.ts', "import type { Snapshot } from '../proposals/records.js';\n", '');
    const run = spawnSync('pnpm', ['-s', 'depcruise'], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /error app-not-server: app\/src\/api\.js → server\/src\/clock\.ts/);
    assert.match(run.stdout, /error support-not-tree: server\/src\/auth\/sessions\.ts → server\/src\/tree\/persons\.ts/);
    assert.match(run.stdout, /1 stale known violations in the baseline/);
    // The stale entry alone fails too, so the baseline only shrinks.
    for (const file of ['app/src/api.js', 'server/src/auth/sessions.ts']) cpSync(join(ROOT, file), join(dir, file));
    const stale = spawnSync('pnpm', ['-s', 'depcruise'], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(stale.status, 0);
    assert.doesNotMatch(stale.stdout, /error (app-not-server|support-not-tree)/);
  });
});

// ---------------------------------------------------------------- jscpd (.jscpd.json)

describe('jscpd', () => {
  test('a copy of 40 lines fails (the near-copy pickers were about 60), one of 20 does not', (t) => {
    const dir = copyOfRepo(t);
    /** The same `n` lines of code in two new app modules. */
    const copy = (n) => {
      const lines = Array.from({ length: n }, (_, i) => `  if (form.field${i} !== undefined) out.push(['field${i}', String(form.field${i}).trim()]);`);
      for (const name of ['first', 'second']) {
        writeFileSync(join(dir, `app/src/${name}-picker.js`), `export function ${name}(form, out) {\n${lines.join('\n')}\n  return out;\n}\n`);
      }
    };
    copy(20);
    const short = spawnSync('pnpm', ['-s', 'jscpd'], { cwd: dir, encoding: 'utf8' });
    assert.equal(short.status, 0, short.stdout);
    copy(40);
    const long = spawnSync('pnpm', ['-s', 'jscpd'], { cwd: dir, encoding: 'utf8' });
    assert.equal(long.status, 1, long.stdout);
    assert.match(long.stdout, /app\/src\/first-picker\.js/);
  });
});
