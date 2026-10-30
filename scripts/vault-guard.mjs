#!/usr/bin/env node
// Keeps names from the Owner's private Vault out of this public repo (issue #36, ADR 0010).
//
// The terms to block live in a private denylist that is never committed:
//   $RODOKMEN_DENYLIST, or ~/.config/rodokmen/vault-denylist.txt
// One term per line; `#` starts a comment. Matching ignores case, diacritics and the
// separators - _ . / (so "Jan Novák" also matches the slug "jan-novak").
//
// Usage:
//   node scripts/vault-guard.mjs --staged             check the staged changes (pre-commit hook)
//   node scripts/vault-guard.mjs --range A..B         check commits A..B: added lines, file names, messages (pre-push hook)
//   node scripts/vault-guard.mjs --text FILE|-        check text, e.g. an issue or PR body before posting it
//   node scripts/vault-guard.mjs --build-from-vault PATH [--out FILE]
//                                                     write the denylist from a Vault checkout
// Exit codes: 0 clean, 1 a term was found, 2 usage error or (with --require-list) no denylist.
// Without a denylist the checks warn and pass, so contributors without the Vault are not blocked;
// add --require-list where a missing list must fail.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** Paths never checked: public reference data that legitimately holds every Czech place name, and third-party code. */
export const SKIPPED_PATHS = [/^app\/data\//, /(^|\/)vendor\//, /(^|\/)node_modules\//, /^pnpm-lock\.yaml$/];

/** Terms shorter than this are too likely to match ordinary words. */
const MIN_TERM_LENGTH = 4;

const EXTRA_FOLDS = { ł: 'l', Ł: 'l', ø: 'o', Ø: 'o', đ: 'd', Đ: 'd', ß: 'ss', ẞ: 'ss', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', ð: 'd', þ: 'th' };

/** Lower case, no diacritics, separators (- _ . / and whitespace) collapsed to one space. */
export function fold(text) {
  return text
    .replace(/[łŁøØđĐßẞæÆœŒðþ]/g, (c) => EXTRA_FOLDS[c] ?? c)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s\-_./\\]+/g, ' ')
    .trim();
}

export function defaultDenylistPath() {
  return process.env.RODOKMEN_DENYLIST || join(homedir(), '.config', 'rodokmen', 'vault-denylist.txt');
}

/** Folded terms from a denylist file's text. */
export function parseDenylist(text) {
  const terms = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const term = fold(line);
    if (term.length >= MIN_TERM_LENGTH) terms.add(term);
  }
  return [...terms];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A matcher for folded text: each term must stand alone, not inside a longer word. */
export function matcher(terms) {
  if (terms.length === 0) return () => [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  return (text) => [...fold(text).matchAll(re)].map((m) => m[1]);
}

/**
 * Finds denylisted terms in items of `{ where, text }`.
 * @returns {{ where: string, term: string }[]}
 */
export function findTerms(items, terms) {
  const match = matcher(terms);
  const hits = [];
  for (const { where, text } of items) for (const term of new Set(match(text))) hits.push({ where, term });
  return hits;
}

const skipped = (path) => SKIPPED_PATHS.some((re) => re.test(path));

/** Added lines and file names of a unified diff (`git diff -U0`), as `{ where, text }` items. */
export function diffItems(diff) {
  const items = [];
  let file = null;
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw === '+++ /dev/null' ? null : raw.slice(4).replace(/^b\//, '');
      if (file && !skipped(file)) items.push({ where: `${file} (file name)`, text: file });
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (file === null || skipped(file)) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      items.push({ where: `${file}:${line}`, text: raw.slice(1) });
      line += 1;
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) {
      line += 1;
    }
  }
  return items;
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function stagedItems(cwd) {
  return diffItems(git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--text'], cwd));
}

/** The empty tree: diffing against it shows a whole history as added. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** `range` is `A..B`, or a single commit meaning all of its history. */
function rangeItems(range, cwd) {
  const diffArgs = range.includes('..') ? [range] : [EMPTY_TREE, range];
  const items = diffItems(git(['diff', '-U0', '--no-color', '--no-ext-diff', '--text', ...diffArgs], cwd));
  const log = git(['log', '--format=%H%x00%B%x00', range], cwd).split('\0');
  for (let i = 0; i + 1 < log.length; i += 2) {
    const sha = log[i].trim();
    if (sha) items.push({ where: `commit ${sha.slice(0, 10)} message`, text: log[i + 1] });
  }
  return items;
}

function textItems(source) {
  const text = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8');
  return text.split('\n').map((t, i) => ({ where: `${source === '-' ? 'stdin' : source}:${i + 1}`, text: t }));
}

// ---------------------------------------------------------------------------------------------
// Building the denylist from a Vault checkout

const frontmatter = (text) => /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
const field = (fm, key) => {
  const m = new RegExp(`^\\s*${key}:\\s*"?([^"\\n#]*?)"?\\s*$`, 'm').exec(fm);
  return m?.[1]?.trim() || null;
};
const listField = (fm, key) => {
  const m = new RegExp(`^\\s*${key}:\\s*\\[(.*)\\]\\s*$`, 'm').exec(fm);
  return m
    ? m[1]
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter(Boolean)
    : [];
};
const notes = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => join(dir, f))
    : [];

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
}

/**
 * Candidate terms from a Vault: full names of Persons (given with surname, birth surname and full-name variants),
 * Place names, and the base names of family documents. Surnames alone are left out: too common.
 */
export function vaultTerms(vault) {
  const terms = new Set();
  for (const note of notes(join(vault, 'people'))) {
    const fm = frontmatter(readFileSync(note, 'utf8'));
    const given = field(fm, 'given');
    for (const surname of [field(fm, 'surname'), field(fm, 'birth_surname')]) {
      if (given && surname) terms.add(`${given} ${surname}`);
    }
    for (const variant of listField(fm, 'variants')) if (/\s/.test(variant)) terms.add(variant);
  }
  for (const note of notes(join(vault, 'places'))) {
    const fm = frontmatter(readFileSync(note, 'utf8'));
    const name = field(fm, 'name');
    if (name) terms.add(name);
  }
  for (const file of filesUnder(join(vault, 'attachments', 'documents'))) {
    terms.add(basename(file, extname(file)));
  }
  return [...terms];
}

/** Folded text of every tracked file in the repo, except skipped paths, to drop terms that are already public. */
function publicCorpus(cwd) {
  const files = git(['ls-files', '-z'], cwd)
    .split('\0')
    .filter((f) => f && !skipped(f));
  const parts = [];
  for (const f of files) {
    try {
      const buf = readFileSync(join(cwd, f));
      if (!buf.includes(0)) parts.push(fold(buf.toString('utf8')));
    } catch {
      // Deleted in the working tree: nothing to read.
    }
  }
  return parts.join('\n');
}

/** Terms from the Vault that do not already occur in the public repo (those are generic, such as large towns). */
export function buildDenylist(vault, cwd) {
  const corpus = publicCorpus(cwd);
  const already = matcher(parseDenylist(vaultTerms(vault).join('\n')));
  const present = new Set(already(corpus));
  const kept = [];
  const dropped = [];
  for (const term of vaultTerms(vault)) {
    const folded = fold(term);
    if (folded.length < MIN_TERM_LENGTH) continue;
    (present.has(folded) ? dropped : kept).push(term);
  }
  return { kept: [...new Set(kept)].sort((a, b) => a.localeCompare(b, 'cs')), dropped: [...new Set(dropped)] };
}

// ---------------------------------------------------------------------------------------------

function main() {
  const { values } = parseArgs({
    options: {
      staged: { type: 'boolean', default: false },
      range: { type: 'string' },
      text: { type: 'string' },
      'build-from-vault': { type: 'string' },
      out: { type: 'string' },
      'require-list': { type: 'boolean', default: false },
    },
  });
  const cwd = process.cwd();
  const listPath = defaultDenylistPath();

  if (values['build-from-vault']) {
    const out = values.out ?? listPath;
    const { kept, dropped } = buildDenylist(values['build-from-vault'], cwd);
    mkdirSync(dirname(out), { recursive: true });
    const header = [
      '# Private: names from the Vault that must never reach the public rodokmen-app repo.',
      '# Written by scripts/vault-guard.mjs --build-from-vault; edit freely (one term per line).',
      '# Never commit this file.',
      '',
    ];
    writeFileSync(out, `${header.join('\n')}${kept.join('\n')}\n`, { mode: 0o600 });
    console.log(`vault-guard: wrote ${kept.length} terms to ${out}; ${dropped.length} left out because they already occur in this repo.`);
    return 0;
  }

  const modes = [values.staged, values.range !== undefined, values.text !== undefined].filter(Boolean).length;
  if (modes !== 1) {
    console.error('vault-guard: use exactly one of --staged, --range A..B, --text FILE|-, --build-from-vault PATH');
    return 2;
  }
  if (!existsSync(listPath)) {
    const msg = `vault-guard: no denylist at ${listPath}; nothing checked.`;
    if (values['require-list']) {
      console.error(msg);
      return 2;
    }
    console.error(`${msg} (Owner: build it with --build-from-vault; see AGENTS.md.)`);
    return 0;
  }
  const terms = parseDenylist(readFileSync(listPath, 'utf8'));
  const items = values.staged ? stagedItems(cwd) : values.range !== undefined ? rangeItems(values.range, cwd) : textItems(values.text);
  const hits = findTerms(items, terms);
  if (hits.length === 0) return 0;
  console.error('vault-guard: names from the private Vault found. This repo and its issues are public; replace them with invented ones.');
  for (const h of hits) console.error(`  ${h.where}: "${h.term}"`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
