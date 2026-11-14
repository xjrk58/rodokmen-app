// Task 5.1 and 5.2 of add-tree-charts: the fonts of the Charts are declared as Fontsource
// publishes them, have every letter of Czech, Slovak and German, and app/data/chart-fonts.json
// holds the widths scripts/font-metrics.mjs reads from them.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { advanceOf, loadFaces } from '../../scripts/font-metrics.mjs';
import { FACES, fontFaceRules, fontFile, LETTERS, SUBSETS } from '../../scripts/lib/chart-fonts.mjs';
import { APP } from './helpers.mjs';

test('styles.css declares each face of the Charts from its vendored files, with the unicode ranges of Fontsource', async () => {
  const rules = fontFaceRules(await readFile(join(APP, 'styles.css'), 'utf8'));
  const families = new Set(Object.values(FACES).map((f) => f.family));
  const declared = rules.filter((r) => families.has(r.family));
  assert.equal(declared.length, Object.keys(FACES).length * SUBSETS.length, 'one @font-face per face and subset, and no others');
  for (const face of Object.values(FACES)) {
    const css = await readFile(join(APP, 'node_modules', '@fontsource', face.package, `${face.weight}${face.style === 'italic' ? '-italic' : ''}.css`), 'utf8');
    const published = fontFaceRules(css);
    for (const subset of SUBSETS) {
      const url = fontFile(face, subset);
      const rule = declared.find((r) => r.url === url);
      assert.ok(rule, `styles.css declares ${url}`);
      assert.deepEqual([rule.family, rule.weight, rule.style, rule.display], [face.family, face.weight, face.style, 'swap'], url);
      const theirs = published.find((r) => basename(r.url) === basename(url));
      assert.ok(theirs, `Fontsource declares ${basename(url)}`);
      assert.deepEqual(rule.ranges, theirs.ranges, `${url} has Fontsource's unicode-range`);
    }
  }
});

test('every face has every letter of Czech, Slovak and German, upper and lower case', async () => {
  assert.ok(['č', 'ů', 'ĺ', 'ľ', 'ŕ', 'ô', 'ä', 'ß', 'ẞ', 'Ď', 'Ť', 'Ü'].every((c) => LETTERS.includes(c)));
  for (const [key, face] of Object.entries(await loadFaces())) {
    const missing = [...LETTERS].filter((c) => advanceOf(face, /** @type {number} */ (c.codePointAt(0))) === null);
    assert.deepEqual(missing, [], `${key} (${face.family} ${face.weight} ${face.style}) lacks letters`);
  }
});

test('font-metrics.mjs writes the committed data/chart-fonts.json byte for byte', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chart-fonts-'));
  try {
    const out = join(dir, 'chart-fonts.json');
    await promisify(execFile)(process.execPath, [join(APP, 'scripts', 'font-metrics.mjs'), '--out', out]);
    const committed = await readFile(join(APP, 'data', 'chart-fonts.json'), 'utf8');
    assert.equal(await readFile(out, 'utf8'), committed, 'run `pnpm --filter @rodokmen/app font-metrics` and commit the file');
    /** @type {unknown} */
    const json = JSON.parse(committed);
    const parsed = /** @type {{ faces: Record<string, { fallback: number, advances: Record<string, number> }> }} */ (json);
    assert.deepEqual(Object.keys(parsed.faces), Object.keys(FACES).sort());
    for (const face of Object.values(parsed.faces)) {
      assert.equal(face.fallback, face.advances.n);
      for (const c of LETTERS) assert.ok(Number.isInteger(face.advances[c]), c);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
