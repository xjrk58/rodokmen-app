import type { Plan } from './plan.js';
import type { Issue, IssueKind, Vault } from './reader.js';

/**
 * The importer's report (vault-import spec, "Dry run before anything is submitted"): how many
 * records of each kind, the Proposals planned, and every field or value it cannot map, link to a
 * missing note, invalid date and unreadable file, with where it was found; and where the Vault
 * and the Tree will disagree on Living and on the relation to the family. The report names
 * Vault notes, so it is for the Owner only: it is written where the Owner says, never into the
 * repository.
 */
export interface RunSummary {
  dryRun: boolean;
  batch: { id: string; name: string } | null;
  /** Proposals by what the importer did with them. */
  submitted: number;
  unchanged: number;
  deferred: Array<{ key: string; reason: string }>;
  uploads: number;
  /** Leads created, waiting for their records, already imported; and those an earlier run cut that get the whole note (#136), or not, as changed since. */
  leads: { created: number; waiting: number; unchanged: number; updated: number; notUpdated: string[] };
  /** Notes changed since the run that imported them. */
  changed: { updated: number; notUpdated: string[] };
  /** Marriages an earlier importer gave two Events (#149), with the record ids of the Event to keep and of the other (null while pending). */
  duplicateMarriages: Array<{ paths: [string, string]; keep: string | null; other: string | null }>;
  /**
   * Fields the Tree has no place for, on records an earlier importer wrote without them (#134):
   * added to research notes that still held what it wrote; not added to notes changed since, nor
   * to register entries' Citation notes.
   */
  updates: { added: number; notUpdated: Array<{ path: string; lines: string[]; why: 'changed' | 'citation' }> };
}

export interface Counts {
  notes: Record<string, number>;
  records: Record<string, number>;
  proposals: Record<string, number>;
  files: number;
  leads: { open: number; found: number; notFound: number; searches: number };
  issues: Partial<Record<IssueKind, Record<string, number>>>;
  comparisons: Plan['comparisons'];
}

const ISSUE_TITLES: Record<IssueKind, string> = {
  skippedFolder: 'Folders not imported',
  skippedFile: 'Files not imported',
  unreadable: 'Notes that could not be read',
  noFrontmatter: 'Notes without frontmatter',
  badYaml: 'Notes whose frontmatter is not valid YAML',
  duplicateId: 'Notes with an id another note has',
  brokenLink: 'Links to missing notes',
  badDate: 'Dates that are not valid EDTF',
  unmappedField: 'Fields the Tree has no place for',
  unmappedValue: 'Values that could not be mapped',
  missingFile: 'Files named but not in the Vault',
  unreadableFile: 'Files that cannot be read',
  confidenceDisagreement: 'Source notes cited with different confidences (the lowest is used)',
  livingDiffers: 'Persons whose Living status in the Vault differs from the computed one',
  relationDiffers: 'Persons whose relation to the family in the Vault differs from the computed one',
  marriageDiffers: 'Marriages both spouses record without a Source note, with another date or Place (two Events)',
};

const ISSUE_ORDER: IssueKind[] = [
  'skippedFolder',
  'skippedFile',
  'unreadable',
  'noFrontmatter',
  'badYaml',
  'duplicateId',
  'brokenLink',
  'badDate',
  'unmappedField',
  'unmappedValue',
  'missingFile',
  'unreadableFile',
  'confidenceDisagreement',
  'livingDiffers',
  'relationDiffers',
  'marriageDiffers',
];

/** What an issue is about, without where: the field name, or the kind of value, for counting. */
export function issueKey(i: Issue): string {
  if (i.kind === 'unmappedField') return i.detail;
  if (i.kind === 'brokenLink')
    return (
      i.detail
        .split(':')[0]!
        .replace(/\.\d+\./, '.n.')
        .trim() || 'link'
    );
  if (i.kind === 'badDate' || i.kind === 'marriageDiffers') return i.detail.split(':')[0]!.replace(/\.\d+/, '.n').trim();
  if (i.kind === 'unmappedValue') return i.detail.split(':')[0]!.trim();
  if (i.kind === 'missingFile' || i.kind === 'unreadableFile' || i.kind === 'skippedFile') return (i.path.split('.').at(-1) ?? '').toLowerCase();
  if (i.kind === 'livingDiffers' || i.kind === 'relationDiffers' || i.kind === 'confidenceDisagreement') return i.detail;
  return i.kind;
}

export function countsOf(vault: Vault, plan: Plan): Counts {
  const notes: Record<string, number> = {};
  for (const n of vault.notes) notes[n.folder] = (notes[n.folder] ?? 0) + 1;
  const proposals: Record<string, number> = {};
  for (const p of plan.proposals) proposals[p.kind] = (proposals[p.kind] ?? 0) + 1;
  const issues: Counts['issues'] = {};
  for (const i of plan.issues) {
    const byKey = (issues[i.kind] ??= {});
    const key = issueKey(i);
    byKey[key] = (byKey[key] ?? 0) + 1;
  }
  return {
    notes,
    records: plan.records,
    proposals,
    files: plan.proposals.reduce((n, p) => n + p.files.length, 0),
    leads: {
      open: plan.leads.filter((l) => l.status === 'open').length,
      found: plan.leads.filter((l) => l.status === 'found').length,
      notFound: plan.leads.filter((l) => l.status === 'not_found').length,
      searches: plan.leads.reduce((n, l) => n + l.searches.length, 0),
    },
    issues,
    comparisons: plan.comparisons,
  };
}

const table = (rows: Array<[string, number | string]>) => rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n');

/** Leads an earlier importer cut at 4,000 characters (#136): made whole, or listed as changed since. */
function cutLeads(run: RunSummary): string[] {
  if (!run.leads.updated && !run.leads.notUpdated.length) return [];
  return [
    `Leads an earlier run cut at 4,000 characters (#136): ${run.dryRun ? 'would get' : 'got'} the whole note: ${run.leads.updated};`,
    `changed in the app since, so left as they are (add the rest of the note by hand): ${run.leads.notUpdated.length}.`,
    '',
    ...run.leads.notUpdated.map((path) => `- ${path}`),
    '',
  ];
}

/** Fields the Tree has no place for, on records an earlier importer wrote without them (#134). */
function fieldsNotMapped(run: RunSummary): string[] {
  if (!run.updates.added && !run.updates.notUpdated.length) return [];
  const list = (why: 'changed' | 'citation') => run.updates.notUpdated.filter((u) => u.why === why).map((u) => `- ${u.path}: ${u.lines.join('; ')}`);
  const changed = list('changed');
  const citations = list('citation');
  return [
    '## Fields not mapped, on records imported before #134',
    '',
    `Research notes ${run.dryRun ? 'that would get' : 'that got'} the fields the Tree has no place for: ${run.updates.added}.`,
    '',
    ...(changed.length
      ? [
          `Research notes changed in the app since the import, left as they are (${changed.length}); add these lines by hand if you want them:`,
          '',
          ...changed,
          '',
        ]
      : []),
    ...(citations.length
      ? [
          `Register entries whose Citation note an earlier import wrote (${citations.length}): no Proposal can change a Citation's note without new evidence (#157), so these lines are kept here only:`,
          '',
          ...citations,
          '',
        ]
      : []),
  ];
}

/** Marriages an earlier importer gave two Events (#149): both stay in the Tree. */
function duplicateMarriages(run: RunSummary): string[] {
  if (!run.duplicateMarriages.length) return [];
  return [
    `## Marriage Events imported twice (${run.duplicateMarriages.length})`,
    '',
    'An importer before #149 gave a marriage both spouses record without a Source note one Event in each spouse’s',
    'Proposal. The first Event now carries both notes’ Citations; the other stays, as no Proposal can remove an Event (#154).',
    '',
    ...run.duplicateMarriages.map(
      (d) => `- ${d.paths[0]} and ${d.paths[1]}: keep Event ${d.keep ?? '(pending)'}; the other is Event ${d.other ?? '(pending)'}`,
    ),
    '',
  ];
}

/** The report as Markdown: counts first, then every issue with the note it was found in. */
export function reportMarkdown(vault: Vault, plan: Plan, run: RunSummary): string {
  const c = countsOf(vault, plan);
  const lines: string[] = [];
  lines.push(`# Vault import ${run.dryRun ? 'dry run' : 'run'}`, '');
  lines.push(`Vault: ${vault.root}${vault.commit ? ` at ${vault.commit.sha.slice(0, 12)} (${vault.commit.date})` : ''}`, '');
  if (run.dryRun) lines.push('A dry run: nothing was submitted, uploaded or created.', '');
  else if (run.batch) lines.push(`Import batch: ${run.batch.name} (${run.batch.id})`, '');
  lines.push('## Notes read', '', '| Folder | Notes |', '|---|---|', table(Object.entries(c.notes)), '');
  lines.push('## Records to create', '', '| Kind | Records |', '|---|---|', table(Object.entries(c.records)), '');
  lines.push('## Proposals', '', '| Kind | Planned |', '|---|---|', table(Object.entries(c.proposals)), '');
  lines.push(
    `${run.dryRun ? 'Would submit' : 'Submitted'}: ${run.submitted}; already imported: ${run.unchanged}; waiting: ${run.deferred.length}; files ${run.dryRun ? 'to upload' : 'uploaded'}: ${run.dryRun ? c.files : run.uploads}.`,
    '',
  );
  lines.push(
    '## Research leads',
    '',
    `From plans/ and log/: ${c.leads.open} open, ${c.leads.found} found, ${c.leads.notFound} not found, with ${c.leads.searches} search records.`,
    `${run.dryRun ? '' : `Created: ${run.leads.created}; waiting for the batch to be accepted: ${run.leads.waiting}; already imported: ${run.leads.unchanged}.`}`,
    '',
  );
  lines.push(...cutLeads(run));
  lines.push('## Differences', '', `Living: ${c.comparisons.living}. Relation to the family: ${c.comparisons.relation}.`, '');
  if (run.changed.updated || run.changed.notUpdated.length)
    lines.push(
      '## Changed notes',
      '',
      `Updated: ${run.changed.updated}. Changed but not updated: ${run.changed.notUpdated.length}.`,
      '',
      ...run.changed.notUpdated.map((k) => `- ${k}`),
      '',
    );
  lines.push(...fieldsNotMapped(run), ...duplicateMarriages(run));
  for (const kind of ISSUE_ORDER) {
    const title = ISSUE_TITLES[kind];
    const list = plan.issues.filter((i) => i.kind === kind);
    if (list.length === 0) continue;
    lines.push(
      `## ${title} (${list.length})`,
      '',
      '| What | Count |',
      '|---|---|',
      table(Object.entries(c.issues[kind] ?? {}).sort((a, b) => b[1] - a[1])),
      '',
    );
    lines.push('<details><summary>Where</summary>', '', ...list.map((i) => `- ${i.path}: ${i.detail}`), '', '</details>', '');
  }
  for (const d of run.deferred) lines.push(`- waiting: ${d.key}: ${d.reason}`);
  return `${lines.join('\n').trimEnd()}\n`;
}
