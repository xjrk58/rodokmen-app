#!/usr/bin/env node
// Checks the Markdown docs (`pnpm lint:docs`; the lint workflow runs it on every push):
//   - every relative link or image in a Markdown file of the repo points at a file or folder that exists,
//     and a `#fragment` into a Markdown file names one of its headings;
//   - every Markdown page under docs/ is linked from the docs index, docs/README.md (Diátaxis, issue #77).
// Links inside code blocks and inline code are not links. Links with a scheme (https:, mailto:) are not checked.
// A link starting with `/` is relative to the repo root, as on GitHub.
//
// Usage: node scripts/docs-check.mjs
// Exit codes: 0 clean, 1 a broken link or a page missing from the index.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INDEX = 'docs/README.md';

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)(?:(?!\1)[\s\S])*?\1/g;
const INLINE_LINK = /\]\(\s*<?([^\s()<>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/;
const HTML_LINK = /\b(?:href|src)\s*=\s*"([^"]+)"/g;
const HTML_ANCHOR = /<a\s[^>]*\b(?:id|name)\s*=\s*"([^"]+)"/g;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:|^\/\//i;

/**
 * The lines of a Markdown text outside fenced code blocks, with inline code removed.
 * @param {string} text
 * @returns {{ line: number, text: string }[]}
 */
export function proseLines(text) {
  const out = [];
  let fence = null;
  text.split('\n').forEach((raw, i) => {
    const marker = FENCE.exec(raw)?.[1];
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return;
    }
    if (marker) {
      fence = marker;
      return;
    }
    out.push({ line: i + 1, text: raw.replace(INLINE_CODE, '') });
  });
  return out;
}

/**
 * The link targets of a Markdown text: inline links and images, reference definitions, and HTML href and src.
 * @param {string} text
 * @returns {{ line: number, target: string }[]}
 */
export function linksOf(text) {
  const links = [];
  for (const { line, text: prose } of proseLines(text)) {
    for (const m of prose.matchAll(INLINE_LINK)) links.push({ line, target: m[1] });
    for (const m of prose.matchAll(HTML_LINK)) links.push({ line, target: m[1] });
    const definition = REFERENCE_DEFINITION.exec(prose);
    if (definition) links.push({ line, target: definition[1] });
  }
  return links;
}

/**
 * GitHub's anchor for a heading: lower case, punctuation dropped, spaces as hyphens.
 * @param {string} heading the heading's Markdown text
 */
export function slug(heading) {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '');
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

/**
 * The anchors a Markdown text offers: one per heading (repeats get -1, -2, as on GitHub), and explicit HTML anchors.
 * @param {string} text
 * @returns {Set<string>}
 */
export function anchorsOf(text) {
  const anchors = new Set();
  const seen = new Map();
  for (const { text: prose } of proseLines(text)) {
    const heading = HEADING.exec(prose);
    if (heading) {
      const base = slug(heading[2]);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      anchors.add(n === 0 ? base : `${base}-${n}`);
    }
    for (const m of prose.matchAll(HTML_ANCHOR)) anchors.add(m[1]);
  }
  return anchors;
}

/**
 * Where a relative link from `file` leads, as a repo path, and its fragment; null for links with a scheme.
 * @param {string} file the linking file, relative to the repo root
 * @param {string} target
 * @returns {{ path: string, fragment: string | null } | null}
 */
export function resolveLink(file, target) {
  if (SCHEME.test(target)) return null;
  const hash = target.indexOf('#');
  const fragment = hash === -1 ? null : target.slice(hash + 1);
  let pathPart = (hash === -1 ? target : target.slice(0, hash)).replace(/\?.*$/, '');
  try {
    pathPart = decodeURIComponent(pathPart);
  } catch {
    // Leave a malformed escape as written; the file will not be found.
  }
  if (pathPart === '') return { path: file, fragment };
  const joined = pathPart.startsWith('/') ? pathPart.slice(1) : posix.join(posix.dirname(file), pathPart);
  return { path: posix.normalize(joined).replace(/\/$/, '') || '.', fragment };
}

/**
 * Checks the links of the Markdown files among `files`, and that every page under docs/ is in the index.
 * @param {{ files: string[], read: (path: string) => string }} repo every file of the repo (paths relative to its
 *   root, with `/`), and a function reading one
 * @returns {{ problems: string[], markdown: number, links: number }}
 */
export function checkDocs({ files, read }) {
  const existing = new Set(files);
  for (const f of files) for (let d = posix.dirname(f); d !== '.'; d = posix.dirname(d)) existing.add(d);
  existing.add('.');
  const markdown = files.filter((f) => f.endsWith('.md')).sort();
  const anchors = new Map();
  const anchorsIn = (path) => {
    if (!anchors.has(path)) anchors.set(path, anchorsOf(read(path)));
    return anchors.get(path);
  };

  const problems = [];
  const indexed = new Set();
  let links = 0;
  for (const file of markdown) {
    for (const { line, target } of linksOf(read(file))) {
      const link = resolveLink(file, target);
      if (!link) continue;
      links += 1;
      if (file === INDEX) indexed.add(link.path);
      if (!existing.has(link.path)) problems.push(`${file}:${line}: broken link ${target} (no file ${link.path})`);
      else if (link.fragment && link.path.endsWith('.md') && !anchorsIn(link.path).has(link.fragment))
        problems.push(`${file}:${line}: broken link ${target} (no heading #${link.fragment} in ${link.path})`);
    }
  }
  for (const page of markdown) {
    if (page.startsWith('docs/') && page !== INDEX && !indexed.has(page)) problems.push(`${INDEX}: ${page} is missing from the docs index`);
  }
  return { problems, markdown: markdown.length, links };
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  // Tracked files and new ones not yet added, so a page just written counts; ignored files do not.
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const { problems, markdown, links } = checkDocs({ files, read: (path) => readFileSync(join(root, normalize(path)), 'utf8') });
  for (const problem of problems) console.error(problem);
  if (problems.length) {
    console.error(`docs-check: ${problems.length} problem(s). Fix the link, or add the page to ${INDEX} in its Diátaxis section.`);
    process.exit(1);
  }
  console.log(`docs-check: ${markdown} Markdown files, ${links} relative links, every docs/ page in ${INDEX}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
