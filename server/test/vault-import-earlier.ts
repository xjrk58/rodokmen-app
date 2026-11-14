import type { Plan, PlannedOp } from '../src/vault-import/plan.js';

/**
 * The plans of the importers before the follow-ups of the Owner's real import (#132, #134, #135,
 * #136, #137, #149): this importer's plan turned back into what each earlier one planned, so a test
 * can import a Tree as they left it and run this importer over it.
 */

/** The plan of the importer before #149: the second spouse's note gave the marriage an Event of its own. */
function before149(plan: Plan): void {
  const all = plan.proposals.flatMap((p) => p.ops);
  for (const m of plan.mergedMarriages) {
    const rekey = (o: PlannedOp): PlannedOp => ({
      ...o,
      key: o.key.replace(m.key, m.earlierKey),
      op: { ...o.op, ...Object.fromEntries(Object.entries(o.op).map(([k, v]) => [k, v === `@${m.key}` ? `@${m.earlierKey}` : v])) },
    });
    const created = [all.find((o) => o.key === m.key)!, ...all.filter((o) => o.key.startsWith(`role:${m.key}:`))];
    const p = plan.proposals.find((x) => x.path === m.paths[1])!;
    const first = p.ops.findIndex((o) => o.key.includes(m.key));
    p.ops = [...p.ops.slice(0, first), ...created.map(rekey), ...p.ops.slice(first).map((o) => (o.key.includes(m.key) ? rekey(o) : o))];
  }
}

/** The plan of the importer before #132: no presumed death. */
function before132(plan: Plan): void {
  for (const p of plan.proposals) p.ops = p.ops.filter((o) => !o.key.includes(':presumed-death'));
}

/** The plan of the importer before #134: research notes held the note's body alone (none without one), and a Citation's note the path. */
function before134(plan: Plan): void {
  for (const u of plan.updates.filter((x) => x.topic === 'fields'))
    for (const p of plan.proposals) {
      const i = p.ops.findIndex((o) => o.key === u.freshKey);
      if (i < 0) continue;
      const op = { ...p.ops[i]!.op, ...u.before };
      p.ops = u.before.notes === null ? p.ops.filter((_, j) => j !== i) : p.ops.map((o, j) => (j === i ? { ...o, op, value: JSON.stringify(op) } : o));
    }
}

/**
 * The plan of the importer before #135 and #137, which created records otherwise: a residence with
 * a qualified end, or an end that is an interval, had no date (#135); a Place was linked only to the
 * Municipality of its own name (#137).
 */
function before135and137(plan: Plan): void {
  for (const u of plan.updates.filter((x) => x.topic === 'date' || x.topic === 'municipality'))
    for (const o of plan.proposals.flatMap((p) => p.ops))
      if (o.key === u.freshKey) {
        o.op = { ...o.op, ...u.before };
        o.value = JSON.stringify(o.op);
      }
}

/** The plan of the importer before #136: a lead's reason held the first 4,000 characters of its note. */
function before136(plan: Plan): void {
  for (const lead of plan.leads) lead.reason = lead.earlierReason ?? lead.reason;
}

/** The plan of the importer before all of them. */
export function asEarlierImporters(plan: Plan): void {
  before132(plan);
  before134(plan);
  before136(plan);
  before135and137(plan);
  before149(plan);
}
