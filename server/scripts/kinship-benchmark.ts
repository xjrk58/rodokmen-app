/**
 * Measures kinship on the generated invented Trees (add-kinship, "Performance"): the rebuild of the
 * link copy, a full answer between two Persons, a page of 50 search results, and the boxes of an
 * hourglass, in milliseconds and in units. Nothing here touches the database or real data.
 *
 *   pnpm --filter @rodokmen/server exec tsx --conditions=@rodokmen/source scripts/kinship-benchmark.ts
 */
import { performance } from 'node:perf_hooks';
import { buildKinshipGraph, KinshipSearch, kinshipPaths, kinshipShort, type KinshipGraph } from '@rodokmen/shared';
import { generatedKinshipTree } from '../src/fixture/kinship-generated.js';

const pick = <T>(xs: readonly T[], i: number) => xs[(i * 7919) % xs.length]!;
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)]!, p95: s[Math.floor(s.length * 0.95)]!, max: s[s.length - 1]! };
};
const ms = (n: number) => `${n.toFixed(1)} ms`;

/** The Persons of an hourglass around `focus`: 6 generations up and down, with partners. */
function hourglassOf(g: KinshipGraph, focus: number): number[] {
  const seen = new Set([focus]);
  let up = [focus];
  let down = [focus];
  for (let k = 0; k < 6; k++) {
    up = up.flatMap((v) => g.upOf[v]!.map((i) => g.parentLinks[i]!.parent)).filter((v) => !seen.has(v) && seen.add(v));
    down = down.flatMap((v) => g.downOf[v]!.map((i) => g.parentLinks[i]!.child)).filter((v) => !seen.has(v) && seen.add(v));
  }
  for (const v of [...seen]) for (const f of g.familiesOf[v]!) for (const p of [g.families[f]!.p1, g.families[f]!.p2]) if (p >= 0) seen.add(p);
  return [...seen];
}

for (const shape of ['sparse', 'dense'] as const) {
  const { data, youngest } = generatedKinshipTree(shape);
  const rebuilds: number[] = [];
  let g = buildKinshipGraph(data);
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    g = buildKinshipGraph(data);
    rebuilds.push(performance.now() - t);
  }
  const ix = (id: string) => g.index.get(id)!;
  const full: number[] = [];
  const fullUnits: number[] = [];
  let withPaths = 0;
  for (let i = 0; i < 30; i++) {
    const from = ix(pick(youngest, i));
    const to = ix(pick(youngest, i * 3 + 1));
    const t = performance.now();
    const r = kinshipPaths(new KinshipSearch(g, from), to);
    full.push(performance.now() - t);
    fullUnits.push(r.units);
    if (r.paths.length > 0) withPaths++;
  }
  const pages: number[] = [];
  const pageUnits: number[] = [];
  for (let i = 0; i < 10; i++) {
    const s = new KinshipSearch(g, ix(pick(youngest, i)));
    const t = performance.now();
    let units = 0;
    for (let k = 0; k < 50; k++) units += kinshipShort(s, ix(pick(data.persons, i * 50 + k).id))?.units ?? 0;
    pages.push(performance.now() - t);
    pageUnits.push(units);
  }
  const glasses: number[] = [];
  const boxes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const reader = ix(pick(youngest, i));
    const persons = hourglassOf(g, ix(pick(youngest, i + 5)));
    const s = new KinshipSearch(g, reader);
    const t = performance.now();
    for (const v of persons) kinshipShort(s, v);
    glasses.push(performance.now() - t);
    boxes.push(persons.length);
  }
  const row = (name: string, xs: number[], extra = '') => {
    const s = stats(xs);
    console.log(`  ${name}: median ${ms(s.median)}, p95 ${ms(s.p95)}, max ${ms(s.max)}${extra}`);
  };
  console.log(
    `${shape}: ${data.persons.length} Persons, ${data.families.length} Families, ${data.childLinks.length} child links, ${g.parentLinks.length} parent links`,
  );
  row('rebuild of the link copy', rebuilds);
  row('full answer, 30 pairs', full, ` (units median ${stats(fullUnits).median}, max ${stats(fullUnits).max}; ${withPaths} of 30 related)`);
  row('search page of 50', pages, ` (units median ${stats(pageUnits).median}, max ${stats(pageUnits).max})`);
  row('hourglass', glasses, ` (boxes median ${stats(boxes).median}, max ${stats(boxes).max})`);
}
