#!/usr/bin/env node
// Traces every LemmaScript proof to the OpenSpec requirement it proves (ADR 0009).
//
// A verified function names each requirement it proves with a line
//     //@ contract <capability>: <Requirement name>
// where <Requirement name> is the exact text after "### Requirement: " in
// openspec/specs/<capability>/spec.md or in an active change's
// openspec/changes/<change>/specs/<capability>/spec.md (ADDED or MODIFIED section).
//
// The script fails when
//   - a //@ contract line does not have that form, or names a requirement that does not exist;
//   - a //@ contract line sits in a file that no LemmaScript-files.txt lists, or on a function
//     that lsc does not verify (in a file with //@ verify, the function lacks //@ verify);
//   - a file has //@ verify, requires, ensures, invariant or decreases lines but no
//     LemmaScript-files.txt lists it (so CI would never prove them);
//   - with --check: docs/verification.md is not what this script would write.
//
// It writes docs/verification.md: requirement -> function -> file, and everything the proofs
// assume rather than prove (requires met by unverified callers, //@ assume / havoc / extern,
// axioms or assumes added by hand to the .dfy files).
//
// Usage: node scripts/verification-trace.mjs [--check]
// Needs `pnpm install` (it runs each package's lsc); does not need Dafny.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = 'docs/verification.md';
const CODE = /\.(ts|tsx|mts|js|mjs)$/;
const CONTRACT_LINE = /^\s*\/\/@ contract\s+(.*?)\s*$/;
const CONTRACT_TEXT = /^([a-z0-9][a-z0-9-]*): (\S.*)$/;
const PROOF_LINE = /^\s*\/\/@ (verify|requires|ensures|invariant|decreases)\b/;
const TRUST_MARKER = /^\s*\/\/@ (assume|havoc|extern|autohavoc|impure)\b\s*(.*?)\s*$/;

const problems = [];
const problem = (msg) => problems.push(msg);
const rel = (p) => relative(ROOT, p).split('\\').join('/');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function gitFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  return [...new Set(out.split('\n').filter(Boolean))].filter((f) => existsSync(join(ROOT, f))).sort();
}

// ---------------------------------------------------------------- requirements

/** `capability: Requirement` -> where it is specified. */
function loadRequirements() {
  const requirements = new Map();
  const add = (capability, name, where) => {
    const key = `${capability}: ${name}`;
    if (!requirements.has(key)) requirements.set(key, []);
    requirements.get(key).push(where);
  };
  const scan = (file, capability, where, sections) => {
    let section = null;
    for (const line of read(file).split('\n')) {
      const h2 = /^## (.+?)\s*$/.exec(line);
      if (h2) section = h2[1];
      const req = /^### Requirement: (.+?)\s*$/.exec(line);
      if (req && (sections === null || sections.some((s) => section?.startsWith(s)))) add(capability, req[1], where);
    }
  };
  const specs = join(ROOT, 'openspec/specs');
  if (existsSync(specs)) {
    for (const cap of readdirSync(specs, { withFileTypes: true })) {
      const file = `openspec/specs/${cap.name}/spec.md`;
      if (cap.isDirectory() && existsSync(join(ROOT, file))) scan(file, cap.name, file, null);
    }
  }
  const changes = join(ROOT, 'openspec/changes');
  for (const change of readdirSync(changes, { withFileTypes: true })) {
    if (!change.isDirectory() || change.name === 'archive') continue;
    const dir = join(changes, change.name, 'specs');
    if (!existsSync(dir)) continue;
    for (const cap of readdirSync(dir, { withFileTypes: true })) {
      const file = `openspec/changes/${change.name}/specs/${cap.name}/spec.md`;
      if (cap.isDirectory() && existsSync(join(ROOT, file))) scan(file, cap.name, file, ['ADDED', 'MODIFIED']);
    }
  }
  return requirements;
}

// ---------------------------------------------------------------- verified files

/** Every file listed in a LemmaScript-files.txt, with the package that verifies it. */
function loadManifests(files) {
  const verified = new Map();
  for (const manifest of files.filter((f) => f.endsWith('LemmaScript-files.txt'))) {
    const pkg = dirname(manifest);
    for (const line of read(manifest).split('\n')) {
      const entry = line.trim().split(/\s+/)[0];
      if (!entry || entry.startsWith('#')) continue;
      const file = pkg === '.' ? entry : `${pkg}/${entry}`;
      if (!existsSync(join(ROOT, file))) problem(`${manifest} lists ${entry}, which does not exist`);
      else verified.set(file, { pkg, entry });
    }
  }
  return verified;
}

/** lsc's own view of a file: the functions it verifies, with their //@ contract lines. */
function lscInfo(file, { pkg, entry }) {
  const lsc = join(ROOT, pkg, 'node_modules/.bin/lsc');
  if (!existsSync(lsc)) {
    problem(`${pkg} has no node_modules/.bin/lsc; run pnpm install`);
    return null;
  }
  try {
    return JSON.parse(execFileSync(lsc, ['info', '--typed', entry], { cwd: join(ROOT, pkg), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    problem(`lsc info --typed ${file} failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
    return null;
  }
}

/** Top-level functions of a source file (this repo's formatting: `function name(` ... `}` at column 0). */
function functionsOf(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[<(]/.exec(lines[i]);
    if (!m) continue;
    let end = i;
    while (end < lines.length - 1 && lines[end] !== '}') end++;
    out.push({ name: m[1], start: i, end, exported: lines[i].startsWith('export') });
  }
  return out;
}

/** Lines of the .dfy that are not in the .dfy.gen (the proof additions). */
function proofAdditions(pkg, entry) {
  const config = join(ROOT, pkg, 'lemmascript.json');
  const proofDir = existsSync(config) ? (JSON.parse(readFileSync(config, 'utf8'))['proof-dir'] ?? '.') : '.';
  const base = join(pkg, proofDir, entry.replace(/\.ts$/, ''));
  const dfy = `${base}.dfy`;
  const gen = `${base}.dfy.gen`;
  if (!existsSync(join(ROOT, dfy)) || !existsSync(join(ROOT, gen))) {
    problem(`${rel(join(ROOT, base))}.dfy is missing; run the package's lsc check`);
    return { dfy: rel(join(ROOT, dfy)), lines: [] };
  }
  const generated = new Map();
  for (const line of read(gen).split('\n')) generated.set(line, (generated.get(line) ?? 0) + 1);
  const added = [];
  for (const line of read(dfy).split('\n')) {
    const n = generated.get(line) ?? 0;
    if (n > 0) generated.set(line, n - 1);
    else added.push(line);
  }
  return { dfy: rel(join(ROOT, dfy)), lines: added };
}

// ---------------------------------------------------------------- trace

const files = gitFiles();
const requirements = loadRequirements();
const verifiedFiles = loadManifests(files);
const codeFiles = files.filter((f) => CODE.test(f) && !f.endsWith('.d.ts') && f !== 'scripts/verification-trace.mjs');
const sources = new Map(codeFiles.map((f) => [f, read(f).split('\n')]));

// Every //@ contract line in the code, wherever it is.
const contractLines = [];
for (const [file, lines] of sources) {
  lines.forEach((line, i) => {
    const m = CONTRACT_LINE.exec(line);
    if (m) contractLines.push({ file, line: i + 1, text: m[1] });
  });
}
for (const [file, lines] of sources) {
  const at = lines.findIndex((l) => PROOF_LINE.test(l));
  if (at >= 0 && !verifiedFiles.has(file)) problem(`${file}:${at + 1}: has //@ proof annotations but no LemmaScript-files.txt lists it`);
}
for (const c of contractLines) {
  const where = `${c.file}:${c.line}`;
  const m = CONTRACT_TEXT.exec(c.text);
  if (!m) problem(`${where}: "//@ contract ${c.text}" is not "<capability>: <Requirement name>"`);
  else if (!requirements.has(c.text)) problem(`${where}: no requirement "${m[2]}" in capability "${m[1]}" (openspec/specs or an active change)`);
  if (!verifiedFiles.has(c.file)) problem(`${where}: ${c.file} is not listed in any LemmaScript-files.txt, so nothing proves this contract`);
}

const rows = [];
const assumptions = [];
const supporting = [];
const additions = [];

for (const [file, info] of verifiedFiles) {
  const lscView = lscInfo(file, info);
  if (!lscView) continue;
  const lines = sources.get(file) ?? read(file).split('\n');
  const fns = functionsOf(lines);
  const verifiedNames = new Set(lscView.functions.map((f) => f.name));

  // Contracts in the source must be exactly the contracts lsc extracted.
  const inSource = contractLines.filter((c) => c.file === file).map((c) => c.text).sort();
  const extracted = lscView.functions.flatMap((f) => f.contract ?? []).sort();
  for (const c of contractLines.filter((c) => c.file === file)) {
    const fn = fns.find((f) => f.start < c.line - 1 && c.line - 1 <= f.end);
    if (!fn || !verifiedNames.has(fn.name)) problem(`${c.file}:${c.line}: //@ contract on ${fn ? `"${fn.name}", which lsc does not verify (missing //@ verify?)` : 'no function lsc verifies'}`);
  }
  if (JSON.stringify(inSource) !== JSON.stringify(extracted) && problems.length === 0) {
    problem(`${file}: the //@ contract lines and the contracts lsc extracts differ (${inSource.length} vs ${extracted.length})`);
  }

  for (const fn of lscView.functions) {
    const range = fns.find((f) => f.name === fn.name);
    const body = range ? lines.slice(range.start, range.end + 1) : [];
    const requiresText = body.map((l) => /^\s*\/\/@ requires\s+(.*?)\s*$/.exec(l)?.[1]).filter(Boolean);
    const markers = body.map((l) => TRUST_MARKER.exec(l)).filter(Boolean).map((m) => `\`//@ ${m[1]}${m[2] ? ` ${m[2]}` : ''}\``);
    if (fn.autohavoc) markers.push('`//@ autohavoc`');

    // Unverified production code that calls it: there its requires are assumed, not checked.
    const callers = [];
    const call = new RegExp(`(?<![\\w$.])${fn.name}\\s*\\(`);
    for (const other of fns) {
      if (other.name === fn.name || verifiedNames.has(other.name)) continue;
      if (lines.slice(other.start, other.end + 1).some((l) => call.test(l) && !/^\s*(\/\/|\*)/.test(l))) callers.push(`\`${other.name}\``);
    }
    if (range?.exported) {
      const importer = new RegExp(`import\\s*\\{[^}]*\\b${fn.name}\\b[^}]*\\}\\s*from`);
      for (const [other, otherLines] of sources) {
        if (other === file || /(^|\/)tests?\//.test(other)) continue;
        const text = otherLines.join('\n');
        if (importer.test(text) && otherLines.some((l) => call.test(l))) callers.push(other);
      }
    }
    const assumed = [];
    if (requiresText.length > 0 && callers.length > 0) {
      assumed.push(`its requires, where unverified code calls it (${callers.join(', ')}): ${requiresText.map((r) => `\`${r}\``).join('; ')}`);
    }
    for (const m of markers) assumed.push(m);

    if ((fn.contract ?? []).length === 0) {
      supporting.push({ name: fn.name, file, assumed });
      continue;
    }
    for (const c of fn.contract) rows.push({ requirement: c, name: fn.name, file, assumed });
    if (assumed.length > 0) assumptions.push({ name: fn.name, file, assumed });
  }

  for (const ext of lscView.externs ?? []) {
    assumptions.push({ name: ext.name ?? ext.qualified ?? '(extern)', file, assumed: ['an axiom: its contract is assumed (`//@ extern` or a call into another file)'] });
  }

  const { dfy, lines: added } = proofAdditions(info.pkg, info.entry);
  const lemmas = added.map((l) => /^\s*lemma\s+(?:\{[^}]*\}\s*)?([\w']+)/.exec(l)?.[1]).filter(Boolean);
  const trusted = added.filter((l) => /\bassume\b|\{:axiom\}/.test(l) && !/^\s*\/\//.test(l));
  if (lemmas.length > 0 || added.some((l) => l.trim() && !l.trim().startsWith('//'))) additions.push({ dfy, lemmas });
  if (trusted.length > 0) assumptions.push({ name: dfy, file: dfy, assumed: trusted.map((l) => `added by hand: \`${l.trim()}\``) });
}

// ---------------------------------------------------------------- output

const fnRef = (r) => `\`${r.name}\``;
const byRequirement = [...rows].sort((a, b) => a.requirement.localeCompare(b.requirement) || a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
const specOf = (key) => requirements.get(key)?.[0] ?? '';

const out = [];
out.push('# Verification');
out.push('');
out.push('<!-- Generated by `node scripts/verification-trace.mjs`; do not edit. CI fails when it is out of date. -->');
out.push('');
out.push('Pure rules of the Tree are proved with [LemmaScript](https://github.com/midspiral/LemmaScript) (ADR 0009):');
out.push('the `//@` lines in the TypeScript are the specification, and `lsc check` has Dafny prove that the code meets it.');
out.push('Each proved function names the OpenSpec requirement it proves with `//@ contract <capability>: <Requirement>`;');
out.push('this page lists them, and everything the proofs assume instead of prove.');
out.push('');
out.push('Run the proofs with `pnpm --filter @rodokmen/shared verify` (needs Dafny 4.11 on the PATH), and regenerate');
out.push('this page with `node scripts/verification-trace.mjs`.');
out.push('');
out.push('## Requirements and their proofs');
out.push('');
out.push('| Requirement | Specified in | Function | File | Assumed, not proved |');
out.push('|---|---|---|---|---|');
for (const r of byRequirement) {
  out.push(`| ${r.requirement} | ${specOf(r.requirement)} | ${fnRef(r)} | ${r.file} | ${r.assumed.length === 0 ? 'nothing beyond the trusted base' : 'see below'} |`);
}
out.push('');
out.push('## Assumed, not proved');
out.push('');
out.push('A verified function\'s `requires` are proved wherever a verified function calls it. Where unverified code');
out.push('(the "shell": parsing, I/O, the clock) calls it, they are assumed; the tests cover those callers.');
out.push('');
const seen = new Set();
for (const a of [...assumptions].sort((x, y) => x.file.localeCompare(y.file) || x.name.localeCompare(y.name))) {
  const key = `${a.file}#${a.name}`;
  if (seen.has(key)) continue;
  seen.add(key);
  out.push(`- ${a.name.includes('/') ? a.name : `\`${a.name}\``} (${a.file}):`);
  for (const s of a.assumed) out.push(`  - ${s}`);
}
for (const s of supporting.filter((x) => x.assumed.length > 0)) {
  out.push(`- \`${s.name}\` (${s.file}), supporting:`);
  for (const t of s.assumed) out.push(`  - ${t}`);
}
if (assumptions.length === 0 && !supporting.some((x) => x.assumed.length > 0)) out.push('- nothing');
out.push('');
out.push('## Supporting functions');
out.push('');
out.push('Also proved, with no requirement of their own; the traced functions rely on their contracts.');
out.push('');
const supportByFile = new Map();
for (const s of supporting) supportByFile.set(s.file, [...(supportByFile.get(s.file) ?? []), s.name]);
for (const [file, names] of [...supportByFile].sort()) out.push(`- ${file}: ${names.map((n) => `\`${n}\``).join(', ')}`);
if (supportByFile.size === 0) out.push('- none');
out.push('');
out.push('## Proof additions');
out.push('');
out.push('Lemmas written by hand in the `.dfy` files, on top of what `lsc` generates.');
out.push('');
for (const a of additions.sort((x, y) => x.dfy.localeCompare(y.dfy))) out.push(`- ${a.dfy}: ${a.lemmas.length > 0 ? a.lemmas.map((l) => `\`${l}\``).join(', ') : 'assertions only'}`);
if (additions.length === 0) out.push('- none');
out.push('');
out.push('## Trusted base');
out.push('');
out.push('Every proof above also trusts:');
out.push('');
out.push('- LemmaScript\'s translation of TypeScript to Dafny (`lemmascript` as pinned in the package; a tech preview).');
out.push('  Read the generated `.dfy.gen` when writing a proof; see the known issues in ADR 0009.');
out.push('- Dafny and its Z3 solver (the version pinned in `.github/workflows/verify.yml`).');
out.push('- The model: `number` is a mathematical integer (no floating point, no overflow), strings are sequences of');
out.push('  Unicode scalars, and the proofs say nothing about code outside the `//@ verify` functions.');
out.push('');

const text = `${out.join('\n')}`;
const check = process.argv.includes('--check');

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
if (check) {
  const current = existsSync(join(ROOT, OUTPUT)) ? read(OUTPUT) : '';
  if (current !== text) {
    console.error(`::error::${OUTPUT} is out of date; run node scripts/verification-trace.mjs and commit it`);
    process.exit(1);
  }
  console.log(`${OUTPUT} is up to date: ${rows.length} proof(s) of ${new Set(rows.map((r) => r.requirement)).size} requirement(s).`);
} else {
  writeFileSync(join(ROOT, OUTPUT), text);
  console.log(`Wrote ${OUTPUT}: ${rows.length} proof(s) of ${new Set(rows.map((r) => r.requirement)).size} requirement(s).`);
}
