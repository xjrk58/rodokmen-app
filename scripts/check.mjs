// `pnpm check`: the code checks CI runs, in a fixed order, with one summary at the end (AGENTS.md,
// "Tools before agents"). The lint workflow runs this same script, so local runs and CI cannot
// drift apart. Every check runs even after one fails, so one run shows everything to fix.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** [name, command, arguments]. AGENTS.md names each check; a test holds the two together. */
export const CHECKS = [
  ['typecheck', 'pnpm', ['run', 'typecheck']],
  ['ESLint', 'pnpm', ['run', 'lint:js']],
  ['ShellCheck', 'pnpm', ['run', 'lint:sh']],
  ['Prettier', 'pnpm', ['run', 'format:check']],
  ['knip', 'pnpm', ['run', 'knip']],
  ['dependency-cruiser', 'pnpm', ['run', 'depcruise']],
  ['jscpd', 'pnpm', ['run', 'jscpd']],
  ['pnpm audit', 'node', ['scripts/audit.mjs']],
  ['OpenAPI check', 'pnpm', ['--filter', '@rodokmen/server', 'run', 'openapi:check']],
  ['trace check', 'node', ['scripts/verification-trace.mjs', '--check']],
];

function main() {
  const ci = process.env.GITHUB_ACTIONS === 'true';
  const results = [];
  for (const [name, command, args] of CHECKS) {
    console.log(ci ? `::group::${name}` : `\n── ${name}: ${command} ${args.join(' ')}`);
    const started = performance.now();
    const run = spawnSync(command, args, { stdio: 'inherit' });
    const seconds = (performance.now() - started) / 1000;
    const ok = run.status === 0;
    if (ci) console.log('::endgroup::');
    if (ci && !ok) console.log(`::error::${name} failed: run \`${command} ${args.join(' ')}\` locally`);
    results.push({ name, ok, seconds });
  }
  const total = results.reduce((sum, r) => sum + r.seconds, 0);
  const failed = results.filter((r) => !r.ok);
  console.log(`\npnpm check: ${results.length - failed.length} of ${results.length} passed in ${total.toFixed(0)} s`);
  for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(20)} ${r.seconds.toFixed(1).padStart(5)} s`);
  return failed.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main();
