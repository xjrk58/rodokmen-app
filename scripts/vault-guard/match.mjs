// Matching for the Vault-name guard (scripts/vault-guard.mjs): folding, the denylist file, finding terms.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalize } from '../../app/src/text.js';

/** A failure the CLI reports as a message, exiting 2 (a git error, a refused build). */
export class GuardError extends Error {}

/** Terms shorter than this, once folded, are too likely to match ordinary words. */
export const MIN_TERM_LENGTH = 4;

/** Third-party code and the lockfile: never checked, and not part of what counts as already public. */
const SKIPPED_PATHS = [/(^|\/)vendor\//, /(^|\/)node_modules\//, /^pnpm-lock\.yaml$/];
export const skipped = (path) => SKIPPED_PATHS.some((re) => re.test(path));

/** The gazetteer and the other public reference data, which hold every Czech place name: Place terms are not checked there. */
export const REFERENCE_DATA = /^app\/data\//;

export function defaultDenylistPath() {
  return process.env.RODOKMEN_DENYLIST || join(homedir(), '.config', 'rodokmen', 'vault-denylist.txt');
}

/**
 * Folds text for matching: the app's `normalize` (lower case, no diacritics, the letter table it shares with the
 * server and the database), then every run of characters other than letters and digits becomes one space. So
 * "Bohumil Zrzavý" (an invented name) also matches "bohumil-zrzavy.md", "ZRZAVÝ, Bohumil" matches "Zrzavý Bohumil",
 * and "#" or "**" never cut a name.
 */
export function fold(text) {
  return normalize(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// The denylist file

/**
 * Section names of the denylist file. A section starts at a line `# == <name> ==` (a description may follow);
 * lines above the first one belong to the section ''. A rebuild replaces the generated sections only.
 */
export const SECTION = {
  manual: 'manual',
  never: 'never-block',
  people: 'generated people',
  places: 'generated places',
  documents: 'generated documents',
  leftOut: 'generated left-out',
  unnamed: 'generated unnamed',
};
const HEADER = /^#\s*==\s*([a-z][a-z -]*?)\s*==/;

/** The lines of each section of a denylist file, in file order. */
export function sections(text) {
  const out = new Map([['', []]]);
  let current = '';
  for (const line of text.split(/\r?\n/)) {
    const header = HEADER.exec(line);
    if (header) {
      current = header[1];
      if (!out.has(current)) out.set(current, []);
    } else {
      out.get(current).push(line);
    }
  }
  return out;
}

/** The folded term of a denylist line: `#` starts a comment anywhere on the line. */
export const lineTerm = (line) => fold(line.replace(/#.*/, ''));

/**
 * The terms a denylist file blocks, folded: those of every section except never-block, minus the terms listed in
 * never-block. `places` are the blocked terms that come only from the generated places section.
 * @returns {{ terms: string[], places: string[] }}
 */
export function parseDenylist(text) {
  const bySection = new Map();
  for (const [name, lines] of sections(text)) {
    const terms = new Set(lines.map(lineTerm).filter((t) => t.length >= MIN_TERM_LENGTH));
    bySection.set(name, terms);
  }
  const never = bySection.get(SECTION.never) ?? new Set();
  const blocked = new Set();
  const notPlaces = new Set();
  for (const [name, terms] of bySection) {
    if (name === SECTION.never) continue;
    for (const term of terms) {
      if (never.has(term)) continue;
      blocked.add(term);
      if (name !== SECTION.places) notPlaces.add(term);
    }
  }
  return { terms: [...blocked], places: [...blocked].filter((t) => !notPlaces.has(t)) };
}

// ---------------------------------------------------------------------------------------------
// Finding terms

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A regex that finds each term as whole words, overlapping ones too; at one position it reports the longest term. */
function compile(terms) {
  if (terms.length === 0) return null;
  const alternatives = [...terms].sort((a, b) => b.length - a.length).map(escapeRe);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?=(${alternatives.join('|')})(?![\\p{L}\\p{N}]))`, 'gu');
}

/** The folded lines of `text`, joined by spaces so a name broken across lines still matches, and a map back to lines. */
function foldLines(text) {
  let folded = '';
  const starts = [];
  const lines = [];
  text.split('\n').forEach((raw, i) => {
    const part = fold(raw);
    if (!part) return;
    if (folded) folded += ' ';
    starts.push(folded.length);
    lines.push(i);
    folded += part;
  });
  const lineAt = (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lines[lo];
  };
  return { folded, lineAt };
}

/**
 * Finds denylisted terms in items of `{ where, text, line?, skipPlaces? }`. An item's whole text is matched, so a
 * name split across lines is found; when `line` (the number of its first line) is given, a hit reports the line it
 * starts on. Items with `skipPlaces` (reference data) are not checked for Place terms.
 * @param {{ where: string, text: string, line?: number, skipPlaces?: boolean }[]} items
 * @param {{ terms: string[], places?: string[] }} list
 * @returns {{ where: string, term: string }[]}
 */
export function findTerms(items, { terms, places = [] }) {
  const placeSet = new Set(places);
  const all = compile(terms);
  const withoutPlaces = placeSet.size === 0 ? all : compile(terms.filter((t) => !placeSet.has(t)));
  const hits = [];
  const seen = new Set();
  for (const item of items) {
    const re = item.skipPlaces ? withoutPlaces : all;
    if (!re) continue;
    const { folded, lineAt } = foldLines(item.text);
    for (const m of folded.matchAll(re)) {
      const where = item.line === undefined ? item.where : `${item.where}:${item.line + lineAt(m.index)}`;
      const key = `${where}\0${m[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ where, term: m[1] });
    }
  }
  return hits;
}
