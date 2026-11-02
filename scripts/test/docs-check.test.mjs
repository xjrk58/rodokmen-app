// Tests for scripts/docs-check.mjs (issue #77): broken relative links, and docs/ pages missing from the index.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchorsOf, checkDocs, linksOf, resolveLink, slug } from '../docs-check.mjs';

/** A repo of the given files, read from memory. */
const repo = (contents) => ({ files: Object.keys(contents), read: (path) => contents[path] });

const INDEX = `# Docs

- [A tutorial](tutorials/first.md)
- [A decision](adr/0001-a.md)
`;

test('a clean repo passes: links resolve, the index lists every docs/ page', () => {
  const result = checkDocs(
    repo({
      'README.md': '[Docs](docs/README.md), [the app](app/), [a site](https://example.org/x.md)\n',
      'docs/README.md': INDEX,
      'docs/tutorials/first.md': '# First\n\nSee [the decision](../adr/0001-a.md#why-we-chose-it) and [the root](/README.md).\n',
      'docs/adr/0001-a.md': '# A decision\n\n## Why we chose it\n',
      'app/index.html': '',
    }),
  );
  assert.deepEqual(result.problems, []);
  assert.equal(result.markdown, 4);
  assert.equal(result.links, 6);
});

test('a link to a file that does not exist fails, with file and line', () => {
  const { problems } = checkDocs(repo({ 'docs/README.md': '- [Gone](how-to/gone.md)\n', 'README.md': 'Intro\n\n![Diagram](docs/diagram.svg)\n' }));
  assert.deepEqual(problems, [
    'README.md:3: broken link docs/diagram.svg (no file docs/diagram.svg)',
    'docs/README.md:1: broken link how-to/gone.md (no file docs/how-to/gone.md)',
  ]);
});

test('a fragment that names no heading of the Markdown file fails', () => {
  const { problems } = checkDocs(
    repo({ 'docs/README.md': '- [Guide](guide.md#restoring)\n- [Here](#docs)\n- [There](#nowhere)\n# Docs\n', 'docs/guide.md': '# Guide\n\n## Backups\n' }),
  );
  assert.deepEqual(problems, [
    'docs/README.md:1: broken link guide.md#restoring (no heading #restoring in docs/guide.md)',
    'docs/README.md:3: broken link #nowhere (no heading #nowhere in docs/README.md)',
  ]);
});

test('a docs/ page the index does not link fails', () => {
  const { problems } = checkDocs(
    repo({ 'docs/README.md': INDEX, 'docs/tutorials/first.md': '# First\n', 'docs/adr/0001-a.md': '# A\n', 'docs/how-to/new.md': '# New\n' }),
  );
  assert.deepEqual(problems, ['docs/README.md: docs/how-to/new.md is missing from the docs index']);
});

test('links in code blocks and inline code are not links', () => {
  const text =
    'Real [one](a.md).\n\n```md\n[not](b.md)\n```\n\nAlso `[not](c.md)` and\n~~~~\n[not](d.md)\n```\n[still not](e.md)\n~~~~\n[two][ref]\n\n[ref]: f.md "Title"\n<img src="g.svg">\n';
  assert.deepEqual(
    linksOf(text).map((l) => l.target),
    ['a.md', 'f.md', 'g.svg'],
  );
});

test('anchors follow GitHub: lower case, punctuation dropped, repeats numbered', () => {
  assert.equal(slug("The Owner's to-do list for going live"), 'the-owners-to-do-list-for-going-live');
  assert.equal(slug('`/opt/rodokmen/.env` (API, watchdog, image store)'), 'optrodokmenenv-api-watchdog-image-store');
  assert.equal(slug('Diátaxis and [links](x.md)'), 'diátaxis-and-links');
  assert.deepEqual([...anchorsOf('# Notes\n## Notes\n## Notes\n<a id="custom"></a>\n```\n# Not a heading\n```\n')], ['notes', 'notes-1', 'notes-2', 'custom']);
});

test('links resolve relative to the file, or to the repo root with a leading slash', () => {
  assert.deepEqual(resolveLink('docs/how-to/x.md', '../../deploy/README.md#deploys'), { path: 'deploy/README.md', fragment: 'deploys' });
  assert.deepEqual(resolveLink('docs/how-to/x.md', '/GLOSSARY.md'), { path: 'GLOSSARY.md', fragment: null });
  assert.deepEqual(resolveLink('docs/README.md', 'adr/'), { path: 'docs/adr', fragment: null });
  assert.deepEqual(resolveLink('docs/README.md', 'my%20page.md'), { path: 'docs/my page.md', fragment: null });
  assert.equal(resolveLink('docs/README.md', 'https://diataxis.fr'), null);
  assert.equal(resolveLink('docs/README.md', 'mailto:owner@example.org'), null);
});
