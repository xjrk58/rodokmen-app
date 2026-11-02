// pnpm audit for `pnpm check` and the weekly audit workflow (.github/workflows/audit.yml, #21).
// High and critical advisories in production dependencies fail; every other advisory is listed
// and passes, because advisories appear without code changes and the fix is an upgrade PR.
//
//   node scripts/audit.mjs                     list the advisories; exit 1 when one fails
//   node scripts/audit.mjs --issue             on failure, also open an issue with gh, or comment
//                                              on the one still open (the weekly run)
//   node scripts/audit.mjs --issue --dry-run   look for the open issue, but print the command that
//                                              would open or comment on it instead of running it
import { spawnSync } from 'node:child_process';

const TITLE = 'pnpm audit: high or critical advisories in production dependencies';
const FAILING = new Set(['high', 'critical']);

/** The advisories `pnpm audit` reports, or throws when it could not run (no registry, say). */
function audit(prodOnly) {
  const run = spawnSync('pnpm', ['audit', '--json', ...(prodOnly ? ['--prod'] : [])], { encoding: 'utf8' });
  if (run.error) throw run.error;
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    throw new Error(`pnpm audit printed no report (exit ${run.status}): ${run.stderr.trim() || run.stdout.trim()}`);
  }
  if (!report.advisories) throw new Error(`pnpm audit failed: ${JSON.stringify(report.error ?? report)}`);
  return Object.values(report.advisories);
}

/** One line per advisory, in Markdown, with the paths both reports found it on. */
const line = (a, prod) =>
  `- **${a.severity}** ${a.module_name} ${a.vulnerable_versions} (fixed in ${a.patched_versions}), ${prod ? 'production' : 'development only'}: ${a.title} ${a.url}\n` +
  `  via ${[...new Set([...a.findings, ...(prod?.findings ?? [])].flatMap((f) => f.paths))].join(', ')}`;

function gh(args, input, dryRun) {
  if (dryRun) {
    console.log(`[dry run] gh ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}${input ? ` <<'EOF'\n${input}\nEOF` : ''}`);
    return '';
  }
  const run = spawnSync('gh', args, { encoding: 'utf8', input });
  if (run.status !== 0) throw new Error(`gh ${args[0]} ${args[1]} failed: ${run.stderr.trim()}`);
  return run.stdout;
}

/** Opens the issue, or comments on the one still open, so a weekly failure is one issue. */
function report(failing, dryRun) {
  const body = [
    `\`pnpm audit --prod\` reports ${failing.length} high or critical advisor${failing.length === 1 ? 'y' : 'ies'} in production dependencies:`,
    '',
    ...failing.map(([a, prod]) => line(a, prod)),
    '',
    'Fix: upgrade the package (`pnpm update <package>`, or an override in pnpm-workspace.yaml for a transitive one) in a PR, check that `pnpm check` passes, and close this issue. Found by the weekly audit (.github/workflows/audit.yml).',
  ].join('\n');
  const open = JSON.parse(gh(['issue', 'list', '--state', 'open', '--search', `"${TITLE}" in:title`, '--json', 'number,title'], undefined, false));
  const existing = open.find((i) => i.title === TITLE);
  if (existing) gh(['issue', 'comment', String(existing.number), '--body-file', '-'], `Still failing:\n\n${body}`, dryRun);
  else gh(['issue', 'create', '--title', TITLE, '--label', 'bug', '--body-file', '-'], body, dryRun);
}

function main() {
  const args = new Set(process.argv.slice(2));
  const prod = new Map(audit(true).map((a) => [a.id, a]));
  const all = audit(false).map((a) => [a, prod.get(a.id)]);
  const failing = all.filter(([a, inProd]) => inProd && FAILING.has(a.severity));
  for (const entry of all) console.log(`${failing.includes(entry) ? 'FAIL' : 'note'} ${line(...entry)}`);
  if (failing.length === 0) {
    console.log(`pnpm audit: ${all.length} advisories, none high or critical in production dependencies`);
    return 0;
  }
  console.error(`pnpm audit: ${failing.length} high or critical in production dependencies; upgrade them (see above)`);
  if (args.has('--issue')) report(failing, args.has('--dry-run'));
  return 1;
}

process.exitCode = main();
