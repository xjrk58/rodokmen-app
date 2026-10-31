#!/usr/bin/env node
// Keeps names from the Owner's private Vault out of this public repo (issues #36 and #51, ADR 0010).
//
// The terms to block live in a private denylist that is never committed:
//   $RODOKMEN_DENYLIST, or ~/.config/rodokmen/vault-denylist.txt
// One term per line; `#` starts a comment. Matching ignores case, diacritics and punctuation, and finds a term only
// as whole words, also when it is broken across lines (so "Bohumil Zrzavý" matches "bohumil-zrzavy.md", and
// "ZRZAVÝ,\nBohumil" matches "Zrzavý Bohumil"; the names are invented). The file has sections, each starting at a line `# == <name> ==`:
//   manual               the Owner's own additions; a rebuild keeps them
//   never-block          terms never blocked, even when the Vault yields them; a rebuild keeps them
//   generated people     full names, "Given Surname" and "Surname Given", birth surnames too, full-name variants
//   generated places     Place names, also in other languages; not checked in the reference data in app/data/
//   generated documents  base names of family documents
//   generated left-out   Vault terms already in origin/main, as comments: not blocked (copy one to manual to block it)
//   generated unnamed    Vault notes that yielded no name, as comments
//
// Usage:
//   node scripts/vault-guard.mjs --staged             check the staged changes: added lines and file names (pre-commit)
//   node scripts/vault-guard.mjs --range REVS         check each commit of A..B, or of all history up to a single
//                                                     commit: added lines, file names, messages
//   node scripts/vault-guard.mjs --pre-push REMOTE    check what a push publishes (pre-push hook; reads git's ref lines
//                                                     on stdin): every commit not yet on REMOTE, ref names, tag messages
//   node scripts/vault-guard.mjs --text FILE|-        check text, e.g. an issue or PR body before posting it
//   node scripts/vault-guard.mjs --build-from-vault PATH [--out FILE] [--include-surnames]
//       write the denylist from a Vault checkout, leaving out terms already in origin/main (fetch first). Keeps the
//       manual and never-block sections; refuses (exit 2) when the Vault yields no terms. --include-surnames adds
//       each surname alone (off by default, as many surnames are common words or other families' names).
// Add --require-list to a check to fail (exit 2) without a denylist. Without it the checks warn and pass, so
// contributors without the Vault are not blocked.
// Exit codes: 0 clean, 1 a term was found, 2 usage error, git error, refused build, or (with --require-list) no denylist.

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { commitItems, pushItems, stagedItems } from './vault-guard/git.mjs';
import { defaultDenylistPath, findTerms, GuardError, lineTerm, parseDenylist } from './vault-guard/match.mjs';

const USAGE =
  'usage: vault-guard.mjs --staged | --range REVS | --pre-push REMOTE | --text FILE|- [--require-list]\n' +
  '       vault-guard.mjs --build-from-vault PATH [--out FILE] [--include-surnames]';

const OPTIONS = {
  staged: { type: 'boolean' },
  range: { type: 'string' },
  'pre-push': { type: 'string' },
  text: { type: 'string' },
  'build-from-vault': { type: 'string' },
  out: { type: 'string' },
  'include-surnames': { type: 'boolean' },
  'require-list': { type: 'boolean' },
};
const CHECKS = ['staged', 'range', 'pre-push', 'text'];

class UsageError extends Error {}

function textItems(source) {
  const text = readFileSync(source === '-' ? 0 : source, 'utf8');
  return [{ where: source === '-' ? 'stdin' : source, text, line: 1 }];
}

async function build(values, cwd) {
  if (values['require-list']) throw new UsageError('--require-list goes with a check, not with --build-from-vault');
  const { buildDenylist, renderDenylist, writeDenylist } = await import('./vault-guard/build.mjs');
  const out = values.out ?? defaultDenylistPath();
  const previous = existsSync(out) ? readFileSync(out, 'utf8') : '';
  const list = buildDenylist(values['build-from-vault'], cwd, { previous, includeSurnames: values['include-surnames'] ?? false });
  writeDenylist(out, renderDenylist(list));
  // Counts only: the terms themselves stay in the private file.
  const kinds = (o) => `${o.people.length} people, ${o.places.length} places, ${o.documents.length} documents`;
  const terms = (lines) => lines.filter(lineTerm).length;
  console.log(`vault-guard: wrote ${out}: generated ${kinds(list)}; kept ${terms(list.manual)} manual and ${terms(list.never)} never-block terms.`);
  console.log(
    `vault-guard: left out as already in ${list.ref}: ${kinds(list.leftOut)}; ${list.problems.length} notes yielded no name. Both are listed in the file.`,
  );
  return 0;
}

function check(values, cwd) {
  if (values.out !== undefined || values['include-surnames']) throw new UsageError('--out and --include-surnames go with --build-from-vault');
  // Read the pushed refs first, so git can always write them to the hook.
  const updates = values['pre-push'] !== undefined ? readFileSync(0, 'utf8') : '';
  const listPath = defaultDenylistPath();
  if (!existsSync(listPath)) {
    const msg = `vault-guard: no denylist at ${listPath}; nothing checked.`;
    if (values['require-list']) {
      console.error(msg);
      return 2;
    }
    console.error(`${msg} (Owner: build it with --build-from-vault; see AGENTS.md.)`);
    return 0;
  }
  const list = parseDenylist(readFileSync(listPath, 'utf8'));
  const items = values.staged
    ? stagedItems(cwd)
    : values.range !== undefined
      ? commitItems([values.range], cwd)
      : values['pre-push'] !== undefined
        ? pushItems(updates, values['pre-push'], cwd)
        : textItems(values.text);
  const hits = findTerms(items, list);
  if (hits.length === 0) return 0;
  console.error('vault-guard: names from the private Vault found. This repo and its issues are public; replace them with invented ones.');
  for (const h of hits) console.error(`  ${h.where}: "${h.term}"`);
  return 1;
}

async function main() {
  try {
    const { values } = parseArgs({ options: OPTIONS, strict: true, allowPositionals: false });
    const modes = [...CHECKS, 'build-from-vault'].filter((m) => values[m] !== undefined);
    if (modes.length !== 1) throw new UsageError('use exactly one of --staged, --range, --pre-push, --text, --build-from-vault');
    for (const m of ['range', 'pre-push', 'text', 'build-from-vault']) if (values[m] === '') throw new UsageError(`--${m} needs a value`);
    if (values.range?.startsWith('-')) throw new UsageError('--range takes revisions, such as A..B or origin/main');
    return values['build-from-vault'] !== undefined ? await build(values, process.cwd()) : check(values, process.cwd());
  } catch (error) {
    if (error instanceof UsageError || error?.code?.startsWith?.('ERR_PARSE_ARGS')) {
      console.error(`vault-guard: ${error.message}\n${USAGE}`);
    } else if (error instanceof GuardError || error?.code === 'ENOENT') {
      console.error(`vault-guard: ${error.message}`);
    } else {
      console.error(error);
    }
    return 2;
  }
}

process.exitCode = await main();
