// Tests for scripts/vault-guard.mjs (issues #36 and #51). All names here are invented.
// Each test builds its own Vault, repo and denylist, so the tests pass in any order and alone.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs, { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalize } from '../../app/src/text.js';
import { buildDenylist, readVault, renderDenylist } from '../vault-guard/build.mjs';
import { diffItems } from '../vault-guard/git.mjs';
import { findTerms, fold, parseDenylist } from '../vault-guard/match.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'vault-guard.mjs');

/** The list the checks run against, in the sectioned format the builder writes. */
const LIST = `# == manual ==
# == generated people ==
Bohumil Zrzavý
Zrzavý Bohumil
Ottilie Zrzavá
Ottilie Vrabcová
# == generated places ==
Horní Plachtín
# == generated documents ==
RodZrzavych
`;

const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** A fresh Vault, repo (its origin/main at the first commit) and denylist, removed after the test. */
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vault-guard-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const vault = join(dir, 'vault');
  write(
    join(vault, 'people', 'bohumil-zrzavy-1801.md'),
    '---\ntype: person\nname:\n  given: "Bohumil"\n  surname: "Zrzavý"\n  variants: ["Bohumilus Zrzawy", "Bohumil"]\n---\nNotes.\n',
  );
  write(
    join(vault, 'people', 'ottilie-zrzava-x.md'),
    '---\ntype: person\nsex: F\nname:\n  given: "Ottilie"\n  surname: "Zrzavá"\n  birth_surname: "Vrabcová"\n---\n',
  );
  write(join(vault, 'places', 'horni-plachtin.md'), '---\ntype: place\nname: "Horní Plachtín"\nnames:\n  de: "Ober Plachtin"\n---\n');
  write(join(vault, 'places', 'praha.md'), '---\ntype: place\nname: "Praha"\n---\n');
  write(join(vault, 'attachments', 'documents', 'RodZrzavych.pdf'), 'pdf');

  const repo = join(dir, 'repo');
  const list = join(dir, 'denylist.txt');
  // No global or system git config: each test sets what it needs. node must be on PATH for the hooks.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', RODOKMEN_DENYLIST: list };
  env.PATH = `${dirname(process.execPath)}:${env.PATH}`;
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] });
  const tryGit = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', env });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  write(join(repo, 'README.md'), 'Archives in Praha.\n');
  write(join(repo, 'app', 'data', 'municipalities.json'), '[{"name":"Horní Plachtín"}]\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(list, LIST);

  const guard = (args, input, cwd = repo) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, input, encoding: 'utf8', env });
  const stage = (path, text) => {
    write(join(repo, path), text);
    git('add', '-A');
  };
  const commit = (path, text, message = 'Change') => {
    if (path) stage(path, text);
    git('commit', '-q', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD').trim();
  };
  return { dir, vault, repo, list, env, git, tryGit, guard, stage, commit };
}

// ---------------------------------------------------------------------------------------------- matching

test('fold is the app normalize plus punctuation as separators (finding 15)', () => {
  assert.equal(fold('Horní  Plachtín'), 'horni plachtin');
  assert.equal(fold('horni-plachtin.md'), 'horni plachtin md');
  assert.equal(fold('Þóra–Ħavelková'), 'thora havelkova', 'upper-case Þ, en dash, ħ');
  assert.equal(fold('ıŋſ ﬁ Œ'), 'ins fi oe');
  for (const word of ['Łukasz', 'Æthel', 'Straße', 'Đorđe', 'ĸapa', 'ĳs', 'ǉubav']) assert.equal(fold(word), normalize(word), word);
});

test('terms match whole words, in slugs, file names and register order', () => {
  const list = parseDenylist('# comment\nBohumil Zrzavý\nZrzavý Bohumil\nRodZrzavych\nab\n');
  assert.deepEqual(list.terms, ['bohumil zrzavy', 'zrzavy bohumil', 'rodzrzavych']);
  const items = ['see people/bohumil-zrzavy-1801.md', 'file RodZrzavych.pdf', 'ZRZAVÝ, Bohumil', '**Bohumil** Zrzavý', 'Bohumil Zrzavýho', 'nothing here'];
  const hits = findTerms(
    items.map((text, i) => ({ where: String(i), text })),
    list,
  );
  assert.deepEqual([...new Set(hits.map((h) => h.where))], ['0', '1', '2', '3']);
});

test('a # inside a document name no longer cuts the term (finding 14)', (t) => {
  const { vault, repo } = fixture(t);
  write(join(vault, 'attachments', 'documents', 'Matrika #2 Plachtín.pdf'), 'pdf');
  const list = parseDenylist(renderDenylist(buildDenylist(vault, repo)));
  assert.ok(list.terms.includes('matrika 2 plachtin'));
  assert.ok(!list.terms.includes('matrika'), 'a bare "matrika" would block a common word');
  assert.equal(findTerms([{ where: 'x', text: 'see Matrika #2 Plachtín' }], list).length, 1);
});

test('the never-block section unblocks terms; only generated places are Place terms', () => {
  const list = parseDenylist(
    '# == manual ==\nPraha Nová\n# == never-block ==\nHorní Plachtín\n# == generated places ==\nHorní Plachtín\nPraha Nová\nDolní Plachtín\n',
  );
  assert.deepEqual(list.terms.sort(), ['dolni plachtin', 'praha nova']);
  assert.deepEqual(list.places, ['dolni plachtin']);
});

// ---------------------------------------------------------------------------------------------- building

test('readVault takes names both ways round, birth surnames too, never bare surnames by default (finding 8)', (t) => {
  const { vault } = fixture(t);
  const { people, places, documents } = readVault(vault);
  assert.deepEqual(
    people.sort(),
    ['Bohumil Zrzavý', 'Zrzavý Bohumil', 'Bohumilus Zrzawy', 'Ottilie Zrzavá', 'Zrzavá Ottilie', 'Ottilie Vrabcová', 'Vrabcová Ottilie'].sort(),
  );
  assert.deepEqual(places.sort(), ['Horní Plachtín', 'Ober Plachtin', 'Praha']);
  assert.deepEqual(documents, ['RodZrzavych']);
  const withSurnames = readVault(vault, { includeSurnames: true }).people;
  for (const surname of ['Zrzavý', 'Zrzavá', 'Vrabcová']) assert.ok(withSurnames.includes(surname), surname);
});

test('readVault parses real YAML and reports notes without a name (finding 7)', (t) => {
  const { vault } = fixture(t);
  const crlf = "---\r\ntype: person\r\nname:\r\n  given: 'Kunhuta' # as in the register\r\n  surname: Dlabalová\r\n";
  write(join(vault, 'people', 'kunhuta.md'), `${crlf}  variants:\r\n    - Kunigunda Dlabal\r\n---\r\n`);
  write(join(vault, 'people', 'kvido.md'), '---\nname:\n  given: Kvido\n  given: Kvidoslav\n  surname: Bartůněk\n---\n');
  write(join(vault, 'people', 'unknown.md'), '---\nname:\n  given: "?"\n  surname: Bartůňková\n---\n');
  write(join(vault, 'people', 'broken.md'), '---\nname: [given\n---\n');
  const { people, problems } = readVault(vault);
  for (const name of ['Kunhuta Dlabalová', 'Dlabalová Kunhuta', 'Kunigunda Dlabal', 'Kvidoslav Bartůněk']) assert.ok(people.includes(name), name);
  assert.ok(!people.some((p) => fold(p) === 'bartunkova'), 'a "?" given name leaves a bare surname');
  assert.equal(problems.length, 2);
  assert.match(problems.join('\n'), /people\/unknown\.md: no full name/);
  assert.match(problems.join('\n'), /people\/broken\.md: YAML/);
});

test('buildDenylist reads each Vault note once (lower priority)', (t) => {
  const { vault, repo } = fixture(t);
  const reads = new Map();
  const original = fs.readFileSync;
  mock.method(fs, 'readFileSync', function (path, ...rest) {
    if (String(path).startsWith(vault)) reads.set(String(path), (reads.get(String(path)) ?? 0) + 1);
    return original.call(this, path, ...rest);
  });
  syncBuiltinESMExports();
  try {
    buildDenylist(vault, repo);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(reads.size, 4);
  assert.deepEqual([...new Set(reads.values())], [1]);
});

test('buildDenylist counts only origin/main as public, not the working tree or local commits (finding 4)', (t) => {
  const { vault, repo, commit } = fixture(t);
  commit('docs/local.md', 'Ottilie Zrzavá, not pushed yet.\n');
  write(join(repo, 'README.md'), 'Archives in Praha. Bohumil Zrzavý, uncommitted.\n');
  const { people, leftOut } = buildDenylist(vault, repo);
  assert.ok(people.includes('Ottilie Zrzavá'));
  assert.ok(people.includes('Bohumil Zrzavý'));
  assert.deepEqual(leftOut.places, ['Praha']);
});

test('buildDenylist lists the terms left out as already public, but not app/data/ ones (lower priority)', (t) => {
  const { vault, repo } = fixture(t);
  const built = buildDenylist(vault, repo);
  assert.ok(built.places.includes('Horní Plachtín'), 'app/data/ is not public text, so the village stays on the list');
  assert.ok(!built.places.includes('Praha'));
  assert.match(renderDenylist(built), /^# == generated left-out ==.*\n# Praha$/m);
});

test('--build-from-vault keeps the manual and never-block sections, chmods 600, refuses empty results (finding 6)', (t) => {
  const { dir, vault, list, guard } = fixture(t);
  writeFileSync(list, '# == manual == mine\nKvido Bartůněk # cousin\n# == never-block ==\nOber Plachtin\n# == generated people ==\nStale Name\n');
  chmodSync(list, 0o644);
  const built = guard(['--build-from-vault', vault, '--out', list]);
  assert.equal(built.status, 0, built.stderr);
  const text = readFileSync(list, 'utf8');
  assert.match(text, /# == manual == .*\nKvido Bartůněk # cousin\n/);
  assert.match(text, /# == never-block == .*\nOber Plachtin\n/);
  assert.doesNotMatch(text, /Stale Name/);
  assert.equal(statSync(list).mode & 0o777, 0o600);
  const terms = parseDenylist(text).terms;
  assert.ok(terms.includes('kvido bartunek') && terms.includes('horni plachtin') && !terms.includes('ober plachtin'));

  const wrong = guard(['--build-from-vault', join(dir, 'no-such-vault'), '--out', list]);
  assert.equal(wrong.status, 2);
  mkdirSync(join(dir, 'empty', 'people'), { recursive: true });
  const empty = guard(['--build-from-vault', join(dir, 'empty'), '--out', list]);
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /no terms; nothing written/);
  assert.equal(readFileSync(list, 'utf8'), text);

  writeFileSync(list, '# old format\nBohumil Zrzavý\n');
  const legacy = guard(['--build-from-vault', vault, '--out', list]);
  assert.equal(legacy.status, 2);
  assert.match(legacy.stderr, /outside any section/);
});

// ---------------------------------------------------------------------------------------------- --staged

test('--staged blocks a commit adding a name, and passes one without', (t) => {
  const { guard, stage } = fixture(t);
  stage('docs/note.md', 'An example from Horní Plachtín.\n');
  const blocked = guard(['--staged']);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /docs\/note\.md:1: "horni plachtin"/);
  stage('docs/note.md', 'An example from Dolní Lhota.\n');
  assert.equal(guard(['--staged']).status, 0);
});

test('--staged checks app/data/ for every term except Places (finding 9)', (t) => {
  const { guard, stage } = fixture(t);
  stage('app/data/municipalities.json', '[{"name":"Horní Plachtín"},{"name":"Dolní Plachtín"}]\n');
  assert.equal(guard(['--staged']).status, 0);
  stage('app/data/municipalities.json', '[{"name":"Horní Plachtín"},{"name":"Bohumil Zrzavý"}]\n');
  const r = guard(['--staged']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /municipalities\.json:1: "bohumil zrzavy"/);
});

test('--staged checks the names of renamed and empty files (finding 2)', (t) => {
  const { git, guard, stage, commit } = fixture(t);
  commit('docs/a.md', 'Invented text.\n');
  git('mv', 'docs/a.md', 'docs/rodzrzavych.md');
  assert.match(guard(['--staged']).stderr, /docs\/rodzrzavych\.md \(file name\)/);
  git('reset', '-q', '--hard');
  stage('docs/ottilie-vrabcova.md', '');
  assert.match(guard(['--staged']).stderr, /docs\/ottilie-vrabcova\.md \(file name\)/);
});

test('--staged reads non-ASCII file names (finding 3)', (t) => {
  const { git, guard, stage } = fixture(t);
  git('config', 'core.quotePath', 'true');
  stage('docs/Ottilie Zrzavá.md', 'Invented text.\n');
  const r = guard(['--staged']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /docs\/Ottilie Zrzavá\.md \(file name\): "ottilie zrzava"/);
});

test('--staged does not depend on diff.mnemonicPrefix or diff.noprefix (finding 11)', (t) => {
  const { git, guard, stage } = fixture(t);
  stage('app/data/municipalities.json', '[{"name":"Horní Plachtín"},{"name":"Dolní Plachtín"}]\n');
  for (const key of ['diff.mnemonicPrefix', 'diff.noprefix']) {
    git('config', key, 'true');
    const r = guard(['--staged']);
    assert.equal(r.status, 0, `${key}: ${r.stderr}`);
    git('config', '--unset', key);
  }
});

test('--staged and --text find a name broken across lines (finding 12)', (t) => {
  const { guard, stage } = fixture(t);
  stage('docs/note.md', 'Intro.\nThe register names Bohumil\nZrzavý as the father.\n');
  assert.match(guard(['--staged']).stderr, /docs\/note\.md:2: "bohumil zrzavy"/);
  assert.match(guard(['--text', '-'], 'One.\nOttilie\n\nZrzavá\n').stderr, /stdin:2: "ottilie zrzava"/);
});

test('--staged reads an added line that starts with "++ " as content (finding 13)', (t) => {
  const { guard, stage } = fixture(t);
  stage('docs/note.md', '++ /dev/null\nBohumil Zrzavý\n');
  assert.match(guard(['--staged']).stderr, /docs\/note\.md:2: "bohumil zrzavy"/);
  assert.deepEqual(
    diffItems('diff --git a/x.md b/x.md\n--- a/x.md\n+++ b/x.md\n@@ -1,0 +2,2 @@\n+++ app/data/y\n+Zrzavý\n').map((i) => i.where),
    ['x.md (file name)', 'x.md'],
  );
});

test('diffItems numbers added lines from the hunk header and reads quoted paths', () => {
  const items = diffItems('diff --git a/x.md b/x.md\n--- a/x.md\n+++ b/x.md\n@@ -1 +3,2 @@\n-old\n+one\n+two\n');
  assert.deepEqual(items, [
    { where: 'x.md (file name)', text: 'x.md', skipPlaces: false },
    { where: 'x.md', text: 'one\ntwo', line: 3, skipPlaces: false },
  ]);
  const quoted = diffItems('diff --git "a/a\\tb\\303\\241.md" "b/a\\tb\\303\\241.md"\nnew file mode 100644\n');
  assert.deepEqual(quoted, [{ where: 'a\tbá.md (file name)', text: 'a\tbá.md', skipPlaces: false }]);
});

// ---------------------------------------------------------------------------------------------- history and pushes

test('--range checks each commit, so a name added and removed again is found (finding 1)', (t) => {
  const { git, guard, commit } = fixture(t);
  const base = git('rev-parse', 'HEAD').trim();
  const added = commit('docs/x.md', 'Bohumil Zrzavý\n', 'Add a note');
  commit('docs/x.md', 'Someone\n', 'Reword the note');
  const r = guard(['--range', `${base}..HEAD`]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`commit ${added.slice(0, 10)} docs/x\\.md:1: "bohumil zrzavy"`));
});

test('--range checks added lines, file names and commit messages', (t) => {
  const { git, guard, commit } = fixture(t);
  const base = git('rev-parse', 'HEAD').trim();
  commit('docs/rodzrzavych-summary.md', 'Invented text.\n', 'Add a summary');
  commit('docs/other.md', 'More invented text.\n', 'Mention Ottilie\nZrzavá');
  const r = guard(['--range', `${base}..HEAD`]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /rodzrzavych-summary\.md \(file name\)/);
  assert.match(r.stderr, /message: "ottilie zrzava"/);
});

test('the pre-push hook checks each pushed commit, branch and tag names and tag messages (findings 1, 10)', (t) => {
  const { dir, repo, git, tryGit, commit } = fixture(t);
  git('init', '-q', '--bare', join(dir, 'remote.git'));
  git('remote', 'add', 'origin', join(dir, 'remote.git'));
  git('push', '-q', 'origin', 'main');
  const hooks = join(dir, 'hooks');
  mkdirSync(hooks);
  copyFileSync(join(ROOT, '.githooks', 'pre-push'), join(hooks, 'pre-push'));
  chmodSync(join(hooks, 'pre-push'), 0o755);
  git('config', 'core.hooksPath', hooks);
  mkdirSync(join(repo, 'scripts'));
  symlinkSync(SCRIPT, join(repo, 'scripts', 'vault-guard.mjs'));
  write(join(repo, '.git', 'info', 'exclude'), 'scripts/\n');

  git('checkout', '-q', '-b', 'feature');
  commit('docs/x.md', 'Bohumil Zrzavý\n');
  commit('docs/x.md', 'Someone\n');
  const net = tryGit('push', 'origin', 'feature');
  assert.notEqual(net.status, 0);
  assert.match(net.stderr, /docs\/x\.md:1: "bohumil zrzavy"/);

  git('checkout', '-q', '-b', 'clean', 'main');
  commit('docs/y.md', 'Invented text.\n');
  assert.equal(tryGit('push', 'origin', 'clean').status, 0, 'a clean branch is pushed');
  const branch = tryGit('push', 'origin', 'clean:ottilie-vrabcova');
  assert.notEqual(branch.status, 0);
  assert.match(branch.stderr, /ref name refs\/heads\/ottilie-vrabcova/);
  git('tag', '-a', 'v1', '-m', 'For Bohumil Zrzavý');
  const tag = tryGit('push', 'origin', 'v1');
  assert.notEqual(tag.status, 0);
  assert.match(tag.stderr, /tag refs\/tags\/v1 message: "bohumil zrzavy"/);
});

test('--pre-push copes with a remote that moved on since the last fetch (lower priority)', (t) => {
  const { guard, commit } = fixture(t);
  const head = commit('docs/y.md', 'Invented text.\n');
  const unknown = 'f'.repeat(40);
  const r = guard(['--pre-push', 'origin'], `refs/heads/main ${head} refs/heads/main ${unknown}\n`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
});

// ---------------------------------------------------------------------------------------------- CLI

test('--text checks an issue body from stdin', (t) => {
  const { guard } = fixture(t);
  assert.equal(guard(['--text', '-'], 'The Family roots are Bohumil Zrzavý and his wife.').status, 1);
  assert.equal(guard(['--text', '-'], 'Comment "decided" once the Family roots are set.').status, 0);
});

test('the CLI also runs through a symlink (finding 5)', (t) => {
  const { dir, env } = fixture(t);
  symlinkSync(SCRIPT, join(dir, 'guard.mjs'));
  const r = spawnSync(process.execPath, [join(dir, 'guard.mjs'), '--text', '-'], { input: 'Bohumil Zrzavý', encoding: 'utf8', env });
  assert.equal(r.status, 1, r.stderr);
});

test('without a denylist it warns and passes, unless --require-list', (t) => {
  const { dir, env } = fixture(t);
  const options = { input: 'x', encoding: 'utf8', env: { ...env, RODOKMEN_DENYLIST: join(dir, 'missing.txt') } };
  const warn = spawnSync(process.execPath, [SCRIPT, '--text', '-'], options);
  assert.equal(warn.status, 0);
  assert.match(warn.stderr, /no denylist/);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--text', '-', '--require-list'], options).status, 2);
});

test('usage and git errors exit 2 with a message, not a stack trace (lower priority)', (t) => {
  const { guard } = fixture(t);
  for (const args of [['--bogus'], ['--staged', '--text', '-'], [], ['--text', '-', '--out', 'x'], ['--range', 'no-such-commit'], ['--range=--output=x']]) {
    const r = guard(args, '');
    assert.equal(r.status, 2, args.join(' '));
    assert.doesNotMatch(r.stderr, /\n\s+at /, args.join(' '));
  }
});
