// Building the Vault-name guard's denylist from a Vault checkout (scripts/vault-guard.mjs --build-from-vault).
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { git } from './git.mjs';
import { findTerms, fold, GuardError, lineTerm, MIN_TERM_LENGTH, REFERENCE_DATA, SECTION, sections, skipped } from './match.mjs';

/** The build cannot go ahead (not a Vault, no terms, a list in the old format). The CLI reports it and exits 2. */
export class BuildError extends GuardError {}

/** The tree whose files count as already public. */
export const PUBLIC_REF = 'origin/main';

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const markdown = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map((f) => join(dir, f))
    : [];

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const texts = (v) => (Array.isArray(v) ? v.map(text) : [text(v)]).filter(Boolean);
const words = (term) => fold(term).split(' ').filter(Boolean).length;

/** A note's frontmatter as data, or null with the reason added to `problems`. */
function frontmatter(path, vault, problems) {
  const where = relative(vault, path);
  const match = FRONTMATTER.exec(readFileSync(path, 'utf8'));
  if (!match) {
    problems.push(`${where}: no frontmatter`);
    return null;
  }
  const doc = parseDocument(match[1], { uniqueKeys: false });
  if (doc.errors.length > 0) {
    problems.push(`${where}: YAML ${doc.errors[0].code}`);
    return null;
  }
  const data = doc.toJS();
  if (!isObject(data)) problems.push(`${where}: frontmatter is not a mapping`);
  return isObject(data) ? data : null;
}

/** The terms of one Person note: every full name both ways round, full-name variants, and optionally surnames alone. */
function personTerms(data, includeSurnames) {
  const name = isObject(data.name) ? data.name : data;
  const given = text(name.given);
  const surnames = [text(name.surname), text(name.birth_surname)].filter(Boolean);
  const terms = [];
  if (fold(given)) for (const surname of surnames) terms.push(`${given} ${surname}`, `${surname} ${given}`);
  terms.push(...texts(name.variants));
  const full = terms.filter((t) => words(t) >= 2);
  return includeSurnames ? [...full, ...surnames] : full;
}

/**
 * Candidate terms from a Vault checkout, read once: Persons' full names ("Given Surname" and "Surname Given", with
 * the birth surname as well), full-name variants, Place names (also in other languages), and the base names of family
 * documents. Surnames alone only with `includeSurnames`. `problems` lists notes that yield no name.
 * @returns {{ people: string[], places: string[], documents: string[], problems: string[] }}
 */
export function readVault(vault, { includeSurnames = false } = {}) {
  const people = new Set();
  const places = new Set();
  const documents = new Set();
  const problems = [];
  for (const note of markdown(join(vault, 'people'))) {
    const data = frontmatter(note, vault, problems);
    if (!data) continue;
    const terms = personTerms(data, includeSurnames);
    if (terms.length === 0) problems.push(`${relative(vault, note)}: no full name (given name and surname) and no full-name variant`);
    for (const term of terms) people.add(term);
  }
  for (const note of markdown(join(vault, 'places'))) {
    const data = frontmatter(note, vault, problems);
    if (!data) continue;
    const names = [text(data.name), ...(isObject(data.names) ? Object.values(data.names).flatMap(texts) : [])].filter(Boolean);
    if (names.length === 0) problems.push(`${relative(vault, note)}: no name`);
    for (const name of names) places.add(name);
  }
  for (const file of filesUnder(join(vault, 'attachments', 'documents'))) documents.add(basename(file, extname(file)));
  // `#` starts a comment in the denylist; it folds to a space anyway, so writing a space instead keeps the term whole.
  const clean = (set) => [...new Set([...set].map((t) => t.replace(/#/g, ' ').replace(/\s+/g, ' ').trim()))].filter((t) => fold(t).length >= MIN_TERM_LENGTH);
  return { people: clean(people), places: clean(places), documents: clean(documents), problems };
}

/** The text files of `ref`'s tree (what is public), except skipped paths and reference data, as `{ where, text }` items. */
function publicFiles(cwd, ref) {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new BuildError(`${cwd} is not a directory`);
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{tree}`], cwd);
  } catch {
    throw new BuildError(`no ${ref} in ${cwd}; run git fetch, so the public tree is known`);
  }
  const blobs = git(['ls-tree', '-r', '-z', ref], cwd)
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf('\t');
      const [, type, sha] = entry.slice(0, tab).split(' ');
      return { type, sha, path: entry.slice(tab + 1) };
    })
    .filter((b) => b.type === 'blob' && !skipped(b.path) && !REFERENCE_DATA.test(b.path));
  const out = git(['cat-file', '--batch'], cwd, { input: blobs.map((b) => `${b.sha}\n`).join(''), buffer: true });
  const files = [];
  let at = 0;
  for (const blob of blobs) {
    const newline = out.indexOf(10, at);
    const size = Number(out.toString('latin1', at, newline).split(' ')[2]);
    const body = out.subarray(newline + 1, newline + 1 + size);
    at = newline + 1 + size + 1;
    if (!body.includes(0)) files.push({ where: blob.path, text: body.toString('utf8') });
  }
  return files;
}

/** The kept lines of a section the builder preserves, without leading and trailing blank lines. */
function kept(lines = []) {
  const out = [...lines];
  while (out.length > 0 && !out[0].trim()) out.shift();
  while (out.length > 0 && !out[out.length - 1].trim()) out.pop();
  return out;
}

/**
 * The new denylist: terms from the Vault that do not already occur in `ref`'s tree (those are generic, such as
 * large towns; they are listed as left out), plus the manual and never-block sections of the `previous` file text.
 */
export function buildDenylist(vault, cwd, { previous = '', includeSurnames = false, ref = PUBLIC_REF } = {}) {
  if (!existsSync(join(vault, 'people')) && !existsSync(join(vault, 'places'))) {
    throw new BuildError(`${vault} is not a Vault checkout (it has no people/ or places/ folder); nothing written`);
  }
  const old = sections(previous);
  if ((old.get('') ?? []).some((line) => lineTerm(line))) {
    throw new BuildError(
      'the existing denylist has terms outside any section (an older format), so a rebuild would lose your edits. ' +
        'Move it away, rebuild, then copy your own additions into its manual section and the terms to unblock into never-block',
    );
  }
  const vaultTerms = readVault(vault, { includeSurnames });
  const all = [...vaultTerms.people, ...vaultTerms.places, ...vaultTerms.documents];
  if (all.length === 0) throw new BuildError(`the Vault at ${vault} yielded no terms; nothing written`);
  const present = new Set(findTerms(publicFiles(cwd, ref), { terms: [...new Set(all.map(fold))] }).map((h) => h.term));
  const byCzech = (a, b) => a.localeCompare(b, 'cs');
  const split = (terms) => ({ kept: terms.filter((t) => !present.has(fold(t))).sort(byCzech), left: terms.filter((t) => present.has(fold(t))) });
  const people = split(vaultTerms.people);
  const places = split(vaultTerms.places);
  const documents = split(vaultTerms.documents);
  return {
    people: people.kept,
    places: places.kept,
    documents: documents.kept,
    leftOut: { people: people.left.sort(byCzech), places: places.left.sort(byCzech), documents: documents.left.sort(byCzech) },
    problems: vaultTerms.problems,
    manual: kept(old.get(SECTION.manual)),
    never: kept(old.get(SECTION.never)),
    includeSurnames,
    ref,
  };
}

/** The denylist file's text for a `buildDenylist` result. */
export function renderDenylist(list) {
  const section = (name, note, lines) => [`# == ${name} == ${note}`, ...lines, ''];
  const commented = (lines) => lines.map((l) => `# ${l}`);
  return [
    '# Private: names from the Vault that must never reach the public rodokmen-app repo. Never commit this file.',
    '# Written by `node scripts/vault-guard.mjs --build-from-vault`. One term per line; `#` starts a comment.',
    '# A rebuild replaces the generated sections and keeps the manual and never-block sections as they are.',
    '',
    ...section(SECTION.manual, 'Your own additions: always blocked.', list.manual),
    ...section(SECTION.never, 'Terms never blocked, even when the Vault yields them (generic words).', list.never),
    ...section(SECTION.people, `Full names both ways round${list.includeSurnames ? ', and surnames alone (--include-surnames)' : ''}.`, list.people),
    ...section(SECTION.places, 'Place names; not checked in app/data/.', list.places),
    ...section(SECTION.documents, 'Base names of family documents.', list.documents),
    ...section(
      SECTION.leftOut,
      `Not blocked: already in ${list.ref}. Copy a line to manual to block it anyway.`,
      commented([...list.leftOut.people, ...list.leftOut.places, ...list.leftOut.documents]),
    ),
    ...section(SECTION.unnamed, 'Vault notes that yielded no name; fix them and rebuild.', commented(list.problems)),
  ].join('\n');
}

/** Writes the denylist, readable by the Owner only (also when the file already existed). */
export function writeDenylist(path, content) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}
