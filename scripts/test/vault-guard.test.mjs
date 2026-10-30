// Tests for scripts/vault-guard.mjs (issue #36). All names here are invented.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildDenylist, diffItems, findTerms, fold, parseDenylist, vaultTerms } from '../vault-guard.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'vault-guard.mjs');
let dir = '';
let repo = '';
let vault = '';
let list = '';

const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const guard = (args, input) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, input, encoding: 'utf8', env: { ...process.env, RODOKMEN_DENYLIST: list } });

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'vault-guard-'));
  vault = join(dir, 'vault');
  write(
    join(vault, 'people', 'bohumil-zrzavy-1801.md'),
    '---\ntype: person\nname:\n  given: "Bohumil"\n  surname: "Zrzavý"\n  variants: ["Bohumilus Zrzawy", "Bohumil"]\n---\nNotes.\n',
  );
  write(join(vault, 'people', 'ottilie-zrzava-x.md'), '---\ntype: person\nname:\n  given: "Ottilie"\n  surname: "Zrzavá"\n  birth_surname: "Vrabcová"\n---\n');
  write(join(vault, 'places', 'horni-plachtin.md'), '---\ntype: place\nname: "Horní Plachtín"\n---\n');
  write(join(vault, 'places', 'praha.md'), '---\ntype: place\nname: "Praha"\n---\n');
  write(join(vault, 'attachments', 'documents', 'RodZrzavych.pdf'), 'pdf');

  repo = join(dir, 'repo');
  mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  write(join(repo, 'README.md'), 'Archives in Praha.\n');
  write(join(repo, 'app', 'data', 'municipalities.json'), '[{"name":"Horní Plachtín"}]\n');
  git('add', '.');
  git('commit', '-q', '-m', 'start');

  list = join(dir, 'denylist.txt');
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('fold ignores case, diacritics and separators', () => {
  assert.equal(fold('Horní  Plachtín'), 'horni plachtin');
  assert.equal(fold('horni-plachtin.md'), 'horni plachtin md');
  assert.equal(fold('Łukasz Æthel'), 'lukasz aethel');
});

test('terms match whole words, in slugs and file names too', () => {
  const terms = parseDenylist('# comment\nBohumil Zrzavý\nRodZrzavych\nab\n');
  assert.deepEqual(terms, ['bohumil zrzavy', 'rodzrzavych']);
  const hits = findTerms(
    [
      { where: 'a', text: 'see people/bohumil-zrzavy-1801.md' },
      { where: 'b', text: 'file RodZrzavych.pdf' },
      { where: 'c', text: 'Bohumil Zrzavýho' },
      { where: 'd', text: 'nothing here' },
    ],
    terms,
  );
  assert.deepEqual(
    hits.map((h) => h.where),
    ['a', 'b'],
  );
});

test('vaultTerms takes full names, full-name variants, places and document names, never bare surnames', () => {
  const terms = vaultTerms(vault).sort();
  assert.deepEqual(terms, ['Bohumil Zrzavý', 'Bohumilus Zrzawy', 'Horní Plachtín', 'Ottilie Vrabcová', 'Ottilie Zrzavá', 'Praha', 'RodZrzavych'].sort());
});

test('buildDenylist drops terms already public in the repo, but not those only in skipped data files', () => {
  const { kept, dropped } = buildDenylist(vault, repo);
  assert.ok(dropped.includes('Praha'));
  assert.ok(kept.includes('Horní Plachtín'), 'app/data/ is skipped, so the village stays on the list');
  assert.ok(!kept.includes('Praha'));
});

test('--build-from-vault writes the list; --staged then blocks a commit adding a name', () => {
  const built = guard(['--build-from-vault', vault, '--out', list]);
  assert.equal(built.status, 0, built.stderr);
  assert.match(readFileSync(list, 'utf8'), /Horní Plachtín/);

  write(join(repo, 'docs', 'note.md'), 'An example from Horní Plachtín.\n');
  git('add', '.');
  const blocked = guard(['--staged']);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /docs\/note\.md:1: "horni plachtin"/);

  write(join(repo, 'docs', 'note.md'), 'An example from Dolní Lhota.\n');
  git('add', '.');
  assert.equal(guard(['--staged']).status, 0);
});

test('--staged ignores public reference data in app/data/', () => {
  write(join(repo, 'app', 'data', 'municipalities.json'), '[{"name":"Horní Plachtín"},{"name":"Bohumil Zrzavý"}]\n');
  git('add', '.');
  assert.equal(guard(['--staged']).status, 0);
  git('commit', '-q', '-m', 'data');
});

test('--range checks added lines, file names and commit messages', () => {
  const base = git('rev-parse', 'HEAD').trim();
  write(join(repo, 'docs', 'rodzrzavych-summary.md'), 'Invented text.\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Add a summary');
  write(join(repo, 'docs', 'other.md'), 'More invented text.\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Mention Ottilie Zrzavá');
  const r = guard(['--range', `${base}..HEAD`]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /rodzrzavych-summary\.md \(file name\)/);
  assert.match(r.stderr, /message: "ottilie zrzava"/);
});

test('--text checks an issue body from stdin', () => {
  assert.equal(guard(['--text', '-'], 'The Family roots are Bohumil Zrzavý and his wife.').status, 1);
  assert.equal(guard(['--text', '-'], 'Comment "decided" once the Family roots are set.').status, 0);
});

test('without a denylist it warns and passes, unless --require-list', () => {
  const env = { ...process.env, RODOKMEN_DENYLIST: join(dir, 'missing.txt') };
  const warn = spawnSync(process.execPath, [SCRIPT, '--text', '-'], { cwd: repo, input: 'x', encoding: 'utf8', env });
  assert.equal(warn.status, 0);
  assert.match(warn.stderr, /no denylist/);
  const strict = spawnSync(process.execPath, [SCRIPT, '--text', '-', '--require-list'], { cwd: repo, input: 'x', encoding: 'utf8', env });
  assert.equal(strict.status, 2);
});

test('diffItems numbers added lines from the hunk header', () => {
  const items = diffItems('+++ b/x.md\n@@ -0,0 +3,2 @@\n+one\n+two\n');
  assert.deepEqual(items, [
    { where: 'x.md (file name)', text: 'x.md' },
    { where: 'x.md:3', text: 'one' },
    { where: 'x.md:4', text: 'two' },
  ]);
});
