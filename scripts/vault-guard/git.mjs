// What the Vault-name guard (scripts/vault-guard.mjs) reads from git: staged changes, commits, pushed refs.
import { execFileSync } from 'node:child_process';
import { GuardError, REFERENCE_DATA, skipped } from './match.mjs';

/** Git failed, for example on an unknown revision. The CLI reports it and exits 2. */
export class GitError extends GuardError {}

/** Settings that change git's output, pinned so the parser reads the same format whatever the user's config. */
const PINNED = [
  ['core.quotePath', 'false'],
  ['diff.noprefix', 'false'],
  ['diff.mnemonicPrefix', 'false'],
  ['diff.relative', 'false'],
  ['diff.suppressBlankEmpty', 'false'],
  ['log.showRoot', 'true'],
  ['log.showSignature', 'false'],
].flatMap(([key, value]) => ['-c', `${key}=${value}`]);

/** Patches with no context, every file as text, a rename as a delete and an add, and the a/ b/ prefixes. */
const PATCH = ['-p', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--text', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/'];

/**
 * Runs git with the pinned settings.
 * @param {string[]} args
 * @param {string} cwd
 * @param {{ input?: string, buffer?: boolean }} [options]
 */
export function git(args, cwd, { input, buffer = false } = {}) {
  try {
    return execFileSync('git', [...PINNED, ...args], {
      cwd,
      input: input === undefined ? undefined : Buffer.from(input),
      encoding: buffer ? 'buffer' : 'utf8',
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = String(error.stderr || error.message)
      .trim()
      .split('\n')[0];
    throw new GitError(`git ${args[0]} failed: ${detail}`);
  }
}

/** Whether `rev` names an object in this repo. */
export function exists(rev, cwd) {
  try {
    git(['rev-parse', '--verify', '--quiet', rev], cwd);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Parsing patches

const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/** Reads the C-quoted string git prints for a path with special characters, starting at `s[start]` (a `"`). */
function readQuoted(s, start) {
  const bytes = [];
  let i = start + 1;
  while (i < s.length && s[i] !== '"') {
    if (s[i] === '\\') {
      const octal = /^[0-7]{3}/.exec(s.slice(i + 1, i + 4));
      if (octal) {
        bytes.push(parseInt(octal[0], 8));
        i += 4;
      } else {
        bytes.push(ESCAPES[s[i + 1]] ?? s.charCodeAt(i + 1));
        i += 2;
      }
    } else {
      const ch = String.fromCodePoint(s.codePointAt(i));
      bytes.push(...Buffer.from(ch));
      i += ch.length;
    }
  }
  return { value: Buffer.from(bytes).toString('utf8'), end: i + 1 };
}

const stripPrefix = (path, prefix) => (path.startsWith(prefix) ? path.slice(prefix.length) : path);

/** The path of a `diff --git a/P b/P` header. With --no-renames both sides name the same path. */
function gitHeaderPath(rest) {
  if (rest.startsWith('"')) return stripPrefix(readQuoted(rest, 0).value, 'a/');
  const length = (rest.length - 5) / 2;
  const path = rest.slice(2, 2 + length);
  return Number.isInteger(length) && rest === `a/${path} b/${path}` ? path : null;
}

/** The path of a `+++ ` header, or null for /dev/null. Git ends a path holding a space with a tab. */
function plusHeaderPath(rest) {
  if (rest === '/dev/null') return null;
  const path = rest.startsWith('"') ? readQuoted(rest, 0).value : rest.replace(/\t$/, '');
  return stripPrefix(path, 'b/');
}

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Reads a patch line by line; see diffItems. */
class PatchReader {
  constructor(prefix) {
    this.prefix = prefix;
    this.items = [];
    this.names = [];
    this.file = null; // the path whose hunks follow
    this.entry = null; // the file of the last `diff --git` header: { path, deleted }
    this.sawMinus = false;
    this.oldLeft = 0; // lines of the current hunk still to come
    this.newLeft = 0;
    this.next = 0; // the line number of the next added line
    this.block = null; // consecutive added lines
  }

  /** Reads a line of hunk content; false when the hunk is over (or the line is not content after all). */
  content(raw) {
    if (this.oldLeft <= 0 && this.newLeft <= 0) return false;
    const kind = raw[0];
    if (kind === '+' && this.newLeft > 0) {
      this.added(raw.slice(1));
      this.newLeft -= 1;
      this.next += 1;
    } else if (kind === '-' && this.oldLeft > 0) {
      this.oldLeft -= 1;
      this.flush();
    } else if (kind === ' ') {
      this.oldLeft -= 1;
      this.newLeft -= 1;
      this.next += 1;
      this.flush();
    } else if (kind !== '\\') {
      this.oldLeft = 0; // The counts were wrong: read the line as a header.
      this.newLeft = 0;
      return false;
    }
    return true;
  }

  /** Reads a line between hunks: a file header or a hunk header. */
  header(raw) {
    this.flush();
    if (raw.startsWith('diff --git ')) {
      this.file = gitHeaderPath(raw.slice('diff --git '.length));
      this.entry = { path: this.file, deleted: false };
      this.names.push(this.entry);
      this.sawMinus = false;
    } else if (raw.startsWith('deleted file mode') && this.entry) {
      this.entry.deleted = true;
    } else if (raw.startsWith('--- ')) {
      this.sawMinus = true;
    } else if (raw.startsWith('+++ ') && this.sawMinus) {
      const path = plusHeaderPath(raw.slice(4));
      if (path !== null) this.file = path;
      if (!this.entry) this.names.push({ path, deleted: path === null });
      else if (this.entry.path === null) this.entry.path = path;
      this.sawMinus = false;
    } else {
      const hunk = HUNK.exec(raw);
      if (!hunk) return;
      this.oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      this.next = Number(hunk[2]);
      this.newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
  }

  added(text) {
    const file = this.file;
    if (file === null || skipped(file)) return;
    if (!this.block || this.block.next !== this.next) {
      this.flush();
      this.block = { where: `${this.prefix}${file}`, line: this.next, lines: [], skipPlaces: REFERENCE_DATA.test(file) };
    }
    this.block.lines.push(text);
    this.block.next = this.next + 1;
  }

  flush() {
    const block = this.block;
    if (block) this.items.push({ where: block.where, text: block.lines.join('\n'), line: block.line, skipPlaces: block.skipPlaces });
    this.block = null;
  }

  result() {
    this.flush();
    const names = this.names
      .filter(({ path, deleted }) => path && !deleted && !skipped(path))
      .map(({ path }) => ({ where: `${this.prefix}${path} (file name)`, text: path, skipPlaces: REFERENCE_DATA.test(path) }));
    return [...names, ...this.items];
  }
}

/**
 * Added text and the names of added or changed files in a patch, as `{ where, text, line?, skipPlaces? }` items.
 * Consecutive added lines form one item, so a name broken across lines is found. Hunk line counts decide what is
 * content, so an added line that looks like a header ("++ x" shows as "+++ x") is read as content. File names come
 * from the `diff --git` headers, so empty files count too; with --no-renames a rename is a delete and an add.
 * @param {string} patch
 * @param {string} [prefix] put before each `where`, e.g. the commit
 */
export function diffItems(patch, prefix = '') {
  const reader = new PatchReader(prefix);
  for (const raw of patch.split('\n')) if (!reader.content(raw)) reader.header(raw);
  return reader.result();
}

// ---------------------------------------------------------------------------------------------
// Sources

/** The staged changes (pre-commit). */
export function stagedItems(cwd) {
  return diffItems(git(['diff', '--cached', ...PATCH], cwd));
}

/**
 * Every commit `git log <revs>` lists, one by one: its added lines and file names, and its message. A merge commit
 * shows what its author changed beyond the automatic merge (--diff-merges=remerge).
 * @param {string[]} revs
 */
export function commitItems(revs, cwd) {
  const items = [];
  const patch = git(['log', '--format=%x00%H', '--diff-merges=remerge', ...PATCH, ...revs, '--'], cwd);
  for (const chunk of patch.split(/^\0/m).slice(1)) {
    const newline = chunk.indexOf('\n');
    const sha = newline === -1 ? chunk : chunk.slice(0, newline);
    items.push(...diffItems(newline === -1 ? '' : chunk.slice(newline + 1), `commit ${sha.slice(0, 10)} `));
  }
  for (const record of git(['log', '-z', '--format=%H%n%B', ...revs, '--'], cwd).split('\0')) {
    const newline = record.indexOf('\n');
    if (newline > 0) items.push({ where: `commit ${record.slice(0, 10)} message`, text: record.slice(newline + 1) });
  }
  return items;
}

const ZERO = /^0+$/;

/**
 * What a push publishes (pre-push): each pushed ref's name, an annotated tag's message, and every commit not yet on
 * the remote. `updates` is what git passes the hook on stdin: "<local ref> <local sha> <remote ref> <remote sha>" per
 * line. Commits on the remote's tracking refs are public already; a remote sha this repo does not have (the remote
 * moved on since the last fetch) is left out of the range rather than failing.
 */
export function pushItems(updates, remote, cwd) {
  const items = [];
  const tips = [];
  const known = [];
  for (const line of updates.split('\n')) {
    const [, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!remoteRef || !localSha || ZERO.test(localSha)) continue; // a deleted ref publishes nothing
    items.push({ where: `ref name ${remoteRef}`, text: remoteRef });
    if (git(['cat-file', '-t', localSha], cwd).trim() === 'tag') {
      const tag = git(['cat-file', 'tag', localSha], cwd);
      items.push({ where: `tag ${remoteRef} message`, text: tag.slice(tag.indexOf('\n\n') + 2) });
    }
    if (exists(`${localSha}^{commit}`, cwd)) tips.push(`${localSha}^{commit}`);
    if (remoteSha && !ZERO.test(remoteSha) && exists(`${remoteSha}^{commit}`, cwd)) known.push(remoteSha);
  }
  if (tips.length > 0) items.push(...commitItems([...tips, '--not', `--remotes=${remote}`, ...known], cwd));
  return items;
}
