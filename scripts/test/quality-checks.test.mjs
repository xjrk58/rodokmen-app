// Proves that the checks of `pnpm check` (AGENTS.md, "Tools before agents") fire on the code that
// caused a real finding in #21, so a later change to their configuration cannot quietly turn them
// off. Each fixture reproduces the original bug; the code names the finding.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

// ---------------------------------------------------------------- pnpm audit (scripts/audit.mjs)

describe('pnpm audit', () => {
  /** An advisory as `pnpm audit --json` reports it. */
  const advisory = (id, name, severity, path) => ({
    id,
    module_name: name,
    severity,
    title: `${name} is unsafe`,
    url: `https://github.com/advisories/GHSA-${id}`,
    vulnerable_versions: '<2.0.0',
    patched_versions: '>=2.0.0',
    findings: [{ version: '1.0.0', paths: [path] }],
  });

  /**
   * Runs scripts/audit.mjs with fake `pnpm` and `gh` first on PATH: pnpm answers with the given
   * advisories, gh with the given open issues, and both log their calls.
   */
  function runAudit(t, { prod, dev = [], open = [], args = [] }) {
    const dir = mkdtempSync(join(tmpdir(), 'audit-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const log = join(dir, 'calls.log');
    const report = (list) => JSON.stringify({ advisories: Object.fromEntries(list.map((a) => [a.id, a])), metadata: {} });
    writeFileSync(join(dir, 'prod.json'), report(prod));
    writeFileSync(join(dir, 'all.json'), report([...prod, ...dev]));
    writeFileSync(join(dir, 'open.json'), JSON.stringify(open));
    const fake = (name, body) => {
      writeFileSync(join(dir, name), `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\n${body}\n`, { mode: 0o755 });
    };
    fake(
      'pnpm',
      `process.stdout.write(fs.readFileSync(${JSON.stringify(dir)} + (args.includes('--prod') ? '/prod.json' : '/all.json')));\nprocess.exitCode = 1;`,
    );
    fake(
      'gh',
      `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, input: args.includes('-') ? fs.readFileSync(0, 'utf8') : undefined }) + '\\n');\nif (args[1] === 'list') process.stdout.write(fs.readFileSync(${JSON.stringify(dir)} + '/open.json'));`,
    );
    const run = spawnSync(process.execPath, [join(ROOT, 'scripts/audit.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    const calls = existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l))
      : [];
    return { ...run, calls };
  }

  test('a high advisory in a production dependency fails, and the weekly run opens an issue', (t) => {
    const run = runAudit(t, { prod: [advisory(1, 'sharp', 'high', 'server>sharp')], args: ['--issue'] });
    assert.equal(run.status, 1);
    assert.deepEqual(
      run.calls.map((c) => c.args.slice(0, 2)),
      [
        ['issue', 'list'],
        ['issue', 'create'],
      ],
    );
    const create = run.calls[1];
    assert.ok(create.args.includes('pnpm audit: high or critical advisories in production dependencies'));
    assert.ok(create.args.includes('bug'));
    assert.match(create.input, /\*\*high\*\* sharp <2\.0\.0 \(fixed in >=2\.0\.0\), production/);
    assert.match(create.input, /via server>sharp/);
  });

  test('while that issue is open, the weekly run comments on it instead of opening another', (t) => {
    const open = [{ number: 77, title: 'pnpm audit: high or critical advisories in production dependencies' }];
    const run = runAudit(t, { prod: [advisory(1, 'sharp', 'critical', 'server>sharp')], open, args: ['--issue'] });
    assert.equal(run.status, 1);
    assert.deepEqual(run.calls[1].args.slice(0, 3), ['issue', 'comment', '77']);
    assert.match(run.calls[1].input, /^Still failing/);
  });

  test('a dry run looks for the open issue but only prints what it would open', (t) => {
    const run = runAudit(t, { prod: [advisory(1, 'sharp', 'high', 'server>sharp')], args: ['--issue', '--dry-run'] });
    assert.equal(run.status, 1);
    assert.deepEqual(
      run.calls.map((c) => c.args[1]),
      ['list'],
    );
    assert.match(run.stdout, /\[dry run\] gh issue create --title "pnpm audit: high or critical advisories in production dependencies" --label bug/);
  });

  test('moderate production and high development-only advisories are listed but pass', (t) => {
    const run = runAudit(t, {
      prod: [advisory(2, 'glob', 'moderate', 'server>@fastify/static>glob')],
      dev: [advisory(3, 'minimatch', 'high', '.>eslint>minimatch')],
      args: ['--issue'],
    });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.calls, []);
    assert.match(run.stdout, /\*\*high\*\* minimatch .* development only/);
  });
});

// ---------------------------------------------------------------- gitleaks (.gitleaks.toml)

describe('gitleaks', () => {
  const usable = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;

  test('fails on a token in the scanned commits only, and allows only the listed test key where it is listed', (t) => {
    if (!usable('docker', ['info']) && !usable('gitleaks', ['version'])) return t.skip('needs Docker or gitleaks');
    const dir = mkdtempSync(join(tmpdir(), 'gitleaks-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const git = (...args) =>
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: dir, encoding: 'utf8' }).trim();
    const commit = (file, text) => {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
      git('add', file);
      git('commit', '-q', '-m', `add ${file}`);
      return git('rev-parse', 'HEAD');
    };
    const scan = (range) => spawnSync(process.execPath, [join(ROOT, 'scripts/gitleaks.mjs'), range], { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    const clean = commit('README.md', 'An invented repo.\n');
    // An invented GitHub token, put together here so that this file holds none.
    const token = ['ghp', randomBytes(27).toString('base64url').replace(/[-_]/g, 'q').slice(0, 36)].join('_');
    const leaked = commit('src/client.js', `export const token = '${token}';\n`);
    const later = commit('src/other.js', 'export const answer = 42;\n');
    assert.equal(scan(`${clean}..${later}`).status, 1);
    assert.equal(scan(`${leaked}..${later}`).status, 0);
    // The deploy test's invented Garage key passes in that file and nowhere else.
    const key = `${['backup', 'key'].join('_')}=GK${'0123456789abcdef01234567'}\n`;
    const listed = commit('deploy/scripts/deploy.test.sh', key);
    assert.equal(scan(`${later}..${listed}`).status, 0);
    const elsewhere = commit('deploy/scripts/other.sh', key);
    assert.equal(scan(`${listed}..${elsewhere}`).status, 1);
  });
});
