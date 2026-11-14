import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import { gatherExport } from './gather.js';
import { gedcomFile } from './gedcom.js';
import { markdownFiles, slugBases } from './markdown.js';
import { publish, type ExportRepoConfig } from './repo.js';
import { slugsFor } from './slugs.js';

/**
 * The nightly Export (exports spec, "Nightly Export to rodokmen-export"): the Markdown notes and
 * family.ged of the Export view of the Tree, pushed to rodokmen-export when something changed.
 * After an erasure, the next run replaces the branch's history with a single commit (erasure spec,
 * "Erasure reaches Exports"), and marks the erasures done once it is pushed.
 *
 * Off unless the Owner configures the repository (config.export, RODOKMEN_EXPORT_*).
 */

export interface ExportDeps {
  db: Db;
  clock: Clock;
  repo: ExportRepoConfig | null;
}

/** The Export's files, by path: the Markdown notes, the README and family.ged. */
export async function exportFiles(db: Db, clock: Clock): Promise<Map<string, string>> {
  const tree = await gatherExport(db, clock);
  const files = markdownFiles(tree, await slugsFor(db, slugBases(tree)));
  files.set('family.ged', gedcomFile(tree));
  return files;
}

/** The GEDCOM file of the Tree, as the nightly Export writes it (exports spec, "GEDCOM download for the Owner"). */
export async function gedcomOfTree(db: Db, clock: Clock): Promise<string> {
  return gedcomFile(await gatherExport(db, clock));
}

/** What a run did, as a daily job reports it. */
export interface ExportRunResult {
  detail: string;
  complete: boolean;
}

export async function runExport(deps: ExportDeps, day: string): Promise<ExportRunResult> {
  if (!deps.repo) return { detail: 'the Export is off', complete: true };
  const pending = (await deps.db.selectFrom('erasure').select('person_id').where('export_replaced_at', 'is', null).execute()).map((e) => e.person_id);
  const files = await exportFiles(deps.db, deps.clock);
  const replaceHistory = pending.length > 0;
  const result = await publish(deps.repo, files, {
    replaceHistory,
    message: replaceHistory ? `Export of ${day}, history replaced after an erasure` : `Export of ${day}`,
    at: deps.clock.now(),
  });
  if (replaceHistory) await deps.db.updateTable('erasure').set({ export_replaced_at: deps.clock.now() }).where('person_id', 'in', pending).execute();
  if (!result.committed) return { detail: `no change (${files.size} files)`, complete: true };
  return { detail: `${replaceHistory ? 'replaced the history with' : 'committed'} ${result.commit} (${files.size} files)`, complete: true };
}
