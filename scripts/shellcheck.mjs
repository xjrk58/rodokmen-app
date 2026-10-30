// ShellCheck for every tracked shell script (`pnpm lint:sh`). Runs the pinned Docker image, so
// local runs and CI report the same thing, and falls back to a `shellcheck` on PATH.
import { execFileSync, spawnSync } from 'node:child_process';

const IMAGE = 'koalaman/shellcheck:v0.11.0';
// ShellCheck's default severity: errors, warnings, and the info and style notes.
const OPTIONS = ['--external-sources', '--format=gcc'];
/** `docker run` exits 125 when Docker itself fails (no daemon, image not pulled offline). */
const DOCKER_FAILED = 125;

const files = execFileSync('git', ['ls-files', '-z', '*.sh', '.githooks/*'], { encoding: 'utf8' }).split('\0').filter(Boolean);

let result = spawnSync('docker', ['run', '--rm', '-v', `${process.cwd()}:/mnt:ro`, '-w', '/mnt', IMAGE, ...OPTIONS, ...files], { stdio: 'inherit' });
if (result.error || result.status === DOCKER_FAILED) {
  console.error(`Docker is not usable (${result.error?.message ?? 'docker run failed'}); trying shellcheck on PATH.`);
  result = spawnSync('shellcheck', [...OPTIONS, ...files], { stdio: 'inherit' });
  if (result.error) {
    console.error(`shellcheck could not run: ${result.error.message}. Install ShellCheck or Docker.`);
    process.exit(2);
  }
}
if (result.status === 0) console.log(`shellcheck: ${files.length} scripts, no findings`);
process.exit(result.status ?? 1);
