import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { tryParseEdtf } from '@rodokmen/shared';
import YAML from 'yaml';

/**
 * Reads the Vault (vault-import spec, "Importer reads the Vault format"): one Markdown note per
 * record in people/, houses/, places/, parishes/, registers/, sources/, plans/ and log/, with YAML
 * frontmatter and [[id]] links, plus the files in attachments/. Any other folder (data/ among them)
 * is skipped and reported. Nothing is interpreted here: the notes are read as they are.
 */
export const NOTE_FOLDERS = ['people', 'houses', 'places', 'parishes', 'registers', 'sources', 'plans', 'log'] as const;
export type NoteFolder = (typeof NOTE_FOLDERS)[number];
const FILE_FOLDERS = ['attachments'];

export interface VaultNote {
  folder: NoteFolder;
  /** The file name without .md: the note's id, which never changes. */
  id: string;
  /** Relative to the Vault, with forward slashes: people/jan-novak-1801.md. */
  path: string;
  data: Record<string, unknown>;
  /** The frontmatter as written. */
  frontmatterText: string;
  /** The note's text after the frontmatter, unchanged but for outer blank lines. */
  body: string;
  /** SHA-256 of the whole file, to tell a changed note on a re-run. */
  hash: string;
}

export type IssueKind =
  | 'skippedFolder'
  | 'unreadable'
  | 'noFrontmatter'
  | 'badYaml'
  | 'duplicateId'
  | 'brokenLink'
  | 'badDate'
  | 'unmappedField'
  | 'unmappedValue'
  | 'missingFile'
  | 'unreadableFile'
  | 'confidenceDisagreement'
  | 'livingDiffers'
  | 'relationDiffers'
  | 'skippedFile';

/** Something the dry run reports: what, where, and the field or value concerned. */
export interface Issue {
  kind: IssueKind;
  /** The note or file, relative to the Vault. */
  path: string;
  /** The field, link or value. */
  detail: string;
}

export interface Vault {
  root: string;
  notes: VaultNote[];
  /** Notes by id (and by alias), across folders. */
  byId: Map<string, VaultNote>;
  /** Files under attachments/, relative to the Vault. */
  files: Set<string>;
  commit: { sha: string; date: string } | null;
  issues: Issue[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

/** A YAML mapping, as a record. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A field as text: strings as they are, numbers written out, anything else empty. */
export const textOf = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** The ids a value links to: [[id]], [[id|shown]] or [[folder/id]], anywhere in a string. */
export function linksIn(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(LINK)].map((m) => m[1]!.trim().split('/').at(-1)!.replace(/\.md$/, ''));
}

/** The one id a field links to, or null when it holds no link. */
export const linkOf = (value: unknown): string | null => linksIn(value)[0] ?? null;

/** A date as the Vault writes it (YAML may read a year as a number), or null when there is none. */
export function dateText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === 'string' ? value.trim() : null;
}

/** Whether a date is valid in the Tree's EDTF subset. */
export const isValidDate = (date: string): boolean => tryParseEdtf(date).ok;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const relPath = (root: string, file: string) => relative(root, file).split(sep).join('/');

/** The commit the Vault is at, when it is a Git checkout and git is installed. */
async function vaultCommit(root: string): Promise<{ sha: string; date: string } | null> {
  try {
    const { stdout } = await promisify(execFile)('git', ['-C', root, 'log', '-1', '--format=%H %cs']);
    const [sha, date] = stdout.trim().split(' ');
    return sha && date ? { sha, date } : null;
  } catch {
    return null;
  }
}

/** One note, parsed; an issue instead when it cannot be read. */
async function readNote(root: string, folder: NoteFolder, file: string): Promise<VaultNote | Issue> {
  const path = relPath(root, file);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    return { kind: 'unreadable', path, detail: error instanceof Error ? error.message : String(error) };
  }
  const m = FRONTMATTER.exec(text.replace(/^\uFEFF/, ''));
  if (!m) return { kind: 'noFrontmatter', path, detail: 'no YAML frontmatter' };
  let data: unknown;
  try {
    data = YAML.parse(m[1]!);
  } catch (error) {
    return { kind: 'badYaml', path, detail: error instanceof Error ? error.message.split('\n')[0]! : 'YAML' };
  }
  if (!isRecord(data)) return { kind: 'badYaml', path, detail: 'the frontmatter is not a mapping' };
  return {
    folder,
    id: path.split('/').at(-1)!.replace(/\.md$/, ''),
    path,
    data,
    frontmatterText: m[1]!,
    body: m[2]!.replace(/^\s*\n/, '').trimEnd(),
    hash: createHash('sha256').update(text).digest('hex'),
  };
}

/** Reads a Vault checkout. */
export async function readVault(root: string): Promise<Vault> {
  const issues: Issue[] = [];
  const notes: VaultNote[] = [];
  const files = new Set<string>();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isDirectory()) {
      if (!entry.name.endsWith('.md')) issues.push({ kind: 'skippedFile', path: entry.name, detail: 'not a note' });
      continue;
    }
    if (FILE_FOLDERS.includes(entry.name)) {
      for (const f of await walk(join(root, entry.name))) files.add(relPath(root, f));
      continue;
    }
    const folder = NOTE_FOLDERS.find((f) => f === entry.name);
    if (!folder) {
      issues.push({ kind: 'skippedFolder', path: `${entry.name}/`, detail: 'not a folder of the Vault format; not imported' });
      continue;
    }
    for (const f of (await walk(join(root, folder))).sort()) {
      if (!f.endsWith('.md')) {
        issues.push({ kind: 'skippedFile', path: relPath(root, f), detail: 'not a note' });
        continue;
      }
      const read = await readNote(root, folder, f);
      if ('kind' in read) issues.push(read);
      else notes.push(read);
    }
  }
  const byId = new Map<string, VaultNote>();
  for (const n of notes) {
    if (byId.has(n.id)) issues.push({ kind: 'duplicateId', path: n.path, detail: `${n.id} is also ${byId.get(n.id)!.path}` });
    else byId.set(n.id, n);
  }
  // Renamed notes keep their old ids as aliases; a link to an old id still finds the note.
  for (const n of notes) {
    const aliases = Array.isArray(n.data.aliases) ? n.data.aliases : [];
    for (const a of aliases) if (typeof a === 'string' && !byId.has(a)) byId.set(a, n);
  }
  return { root, notes, byId, files, commit: await vaultCommit(root), issues };
}

/** Whether a file exists and is not empty. */
export async function fileSize(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}
