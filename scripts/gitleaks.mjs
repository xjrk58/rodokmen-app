// gitleaks (`pnpm gitleaks [range]`; CI runs it over the pushed commits): secrets in commits fail.
// Runs the pinned image, so local runs and CI report the same thing, and falls back to a gitleaks
// on PATH. Rules: gitleaks' own, with the exceptions in .gitleaks.toml.
//
//   node scripts/gitleaks.mjs           the commits not on origin/main yet
//   node scripts/gitleaks.mjs <range>   a `git log` range, e.g. 1a2b3c..HEAD, or --all
import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// v8.30.1, by the digest of its multi-platform index.
const IMAGE = 'ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f';
const CONFIG = join(dirname(fileURLToPath(import.meta.url)), '..', '.gitleaks.toml');
/** `docker run` exits 125 when Docker itself fails (no daemon, image not pulled offline). */
const DOCKER_FAILED = 125;

const range = process.argv[2] ?? 'origin/main..HEAD';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const top = git('rev-parse', '--show-toplevel');
// In a git worktree the history lives in the main checkout's .git, which the container needs too.
const common = realpathSync(git('rev-parse', '--git-common-dir'));
const options = (config) => ['git', '--no-banner', '--redact', '--verbose', `--config=${config}`, `--log-opts=${range}`, top];

const mounts = ['-v', `${top}:${top}:ro`, '-v', `${CONFIG}:/gitleaks.toml:ro`];
if (relative(top, common).startsWith('..')) mounts.push('-v', `${common}:${common}:ro`);
const user = typeof process.getuid === 'function' ? ['--user', `${process.getuid()}:${process.getgid()}`] : [];
// The checkout belongs to another user than the container's git expects: trust it.
const trust = ['-e', 'GIT_CONFIG_COUNT=1', '-e', 'GIT_CONFIG_KEY_0=safe.directory', '-e', 'GIT_CONFIG_VALUE_0=*'];

let result = spawnSync('docker', ['run', '--rm', ...user, ...trust, ...mounts, '-w', top, IMAGE, ...options('/gitleaks.toml')], { stdio: 'inherit' });
if (result.error || result.status === DOCKER_FAILED) {
  console.error(`Docker is not usable (${result.error?.message ?? 'docker run failed'}); trying gitleaks on PATH.`);
  result = spawnSync('gitleaks', options(CONFIG), { stdio: 'inherit' });
  if (result.error) {
    console.error(`gitleaks could not run: ${result.error.message}. Install gitleaks or Docker.`);
    process.exit(2);
  }
}
if (result.status !== 0)
  console.error(
    'gitleaks found what looks like a secret: remove it from the commits (rewrite them before pushing), or add a reasoned exception to .gitleaks.toml.',
  );
process.exit(result.status ?? 1);
