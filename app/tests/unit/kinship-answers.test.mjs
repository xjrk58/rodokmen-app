// The kinship answers the browser tests' mocked API serves (tests/e2e/family-kinship.json) are
// the server's own rules applied to the invented Tree of tests/e2e/family-data.js, with Dorota
// (23) as the reader: shared/src/kinship-paths.ts on the Family links of that Tree. The file is
// rewritten only with UPDATE_GOLDEN=1, so a change to the rules shows in the diff.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import './shared-loader.mjs';
import { FAMILIES, ID, PEOPLE, summary, WEAK_CHILD_LINKS } from '../e2e/family-data.js';

// After shared-loader.mjs: these are TypeScript.
const { buildKinshipGraph } = await import('../../../shared/src/kinship-graph.js');
const { KinshipSearch, kinshipPaths } = await import('../../../shared/src/kinship-paths.js');

const FILE = new URL('../e2e/family-kinship.json', import.meta.url);
export const READER = 23;

/** The Family links of the invented Tree, as the server gathers them. */
function data() {
  const weak = new Set(WEAK_CHILD_LINKS.map(([f, c]) => `${f}:${c}`));
  return {
    persons: PEOPLE.map(([n, sex]) => ({ id: ID(n), sex })),
    families: FAMILIES.map(([f, p1, p2]) => ({
      id: ID(f),
      partner1: p1 ? ID(p1) : null,
      partner2: p2 ? ID(p2) : null,
      married: p1 !== null && p2 !== null,
      confidences: ['high'],
    })),
    childLinks: FAMILIES.flatMap(([f, , , children]) =>
      children.map(([c, type]) => {
        const confidences = weak.has(`${f}:${c}`) ? ['low'] : ['high'];
        return { id: ID(f * 1000 + c), familyId: ID(f), childId: ID(c), type, confidences1: confidences, confidences2: confidences };
      }),
    ),
  };
}

/** Every answer for the reader, by the number of the Person asked about. */
function answers() {
  const g = buildKinshipGraph(data());
  const at = (/** @type {number} */ n) => /** @type {number} */ (g.index.get(ID(n)));
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [n] of PEOPLE) {
    const r = kinshipPaths(new KinshipSearch(g, at(READER)), at(n));
    const ids = new Set([ID(READER), ID(n)]);
    for (const p of r.paths) for (const id of [...p.commonAncestors, ...p.steps.map((/** @type {{ person: string }} */ s) => s.person)]) ids.add(id);
    for (const s of r.connection?.steps ?? []) ids.add(s.person);
    out[n] = {
      from: ID(READER),
      to: ID(n),
      asOf: { logEntryId: null, at: null },
      paths: r.paths,
      more: r.more,
      connection: r.connection,
      persons: [...ids].sort().map((id) => summary(Number(id.slice(-12)))),
    };
  }
  return out;
}

test('the mocked kinship answers are the rules applied to the invented Tree', () => {
  const text = `${JSON.stringify(answers(), null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN === '1') writeFileSync(FILE, text);
  assert.ok(existsSync(FILE), 'run with UPDATE_GOLDEN=1 to write tests/e2e/family-kinship.json');
  assert.equal(readFileSync(FILE, 'utf8'), text);
});
