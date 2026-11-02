import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { runImport } from './run.js';

const Municipalities = z.array(z.object({ code: z.string(), name: z.string(), district: z.string(), lat: z.number(), lon: z.number() }));

/** The repository's list of Municipalities, from the server package (src/ or dist/). */
const MUNICIPALITIES = new URL('../../../app/data/municipalities.json', import.meta.url);

/**
 * `node dist/cli.js vault-import --vault <path> [--dry-run]` (design, "Importer is an API client"),
 * with RODOKMEN_URL and an Agent token in RODOKMEN_TOKEN. Writes the report to --report (by default
 * vault-import-report.md in the current folder) and prints the counts. Returns the exit code, or
 * null for a wrong use.
 */
export async function vaultImportCommand(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = console.log,
): Promise<number | null> {
  const { values } = parseArgs({
    args,
    options: {
      vault: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      report: { type: 'string', default: 'vault-import-report.md' },
      name: { type: 'string' },
      'given-by': { type: 'string', default: 'the Owner' },
      root: { type: 'string', multiple: true, default: [] },
      municipalities: { type: 'string' },
    },
  });
  if (!values.vault) return null;
  const url = env.RODOKMEN_URL;
  const token = env.RODOKMEN_TOKEN;
  if (!url || !token) {
    log('Set RODOKMEN_URL to the server and RODOKMEN_TOKEN to an Agent token the Owner issued.');
    return 2;
  }
  const municipalities = Municipalities.parse(JSON.parse(await readFile(values.municipalities ?? MUNICIPALITIES, 'utf8')));
  const result = await runImport({
    vault: values.vault,
    url,
    token,
    dryRun: values['dry-run'],
    name: values.name,
    givenBy: values['given-by'],
    roots: values.root,
    municipalities,
    today: new Date(),
    log,
  });
  await writeFile(values.report, result.report);
  const { run, counts } = result;
  log(`${run.dryRun ? 'Dry run: nothing was submitted.' : `Import batch ${run.batch?.name ?? '(none)'}.`} Report: ${values.report}`);
  log(`Proposals ${run.dryRun ? 'to submit' : 'submitted'}: ${run.submitted}; already imported: ${run.unchanged}; waiting: ${run.deferred.length}.`);
  log(
    `Records: ${Object.entries(counts.records)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')}.`,
  );
  log(
    `Research leads: ${run.dryRun ? counts.leads.open + counts.leads.found + counts.leads.notFound : run.leads.created} (${run.leads.waiting} wait for the batch to be accepted).`,
  );
  return 0;
}
