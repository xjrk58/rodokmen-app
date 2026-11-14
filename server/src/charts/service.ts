import {
  descendantChart,
  houseChart,
  LINE_GENERATIONS,
  NotADescendant,
  type DescendantChart,
  type DescendantChartQuery,
  type HouseChart,
  type HouseChartQuery,
} from '@rodokmen/shared';
import { ApiProblem } from '../auth/problem.js';
import { gatherDescendants, gatherHouse, keptPerson, type ChartDeps, type ChartStart } from './gather.js';

/**
 * The two Charts (tree-charts spec): gather the rows, then let the pure rules make the model. A
 * merged Person is followed to the kept one, as the other Person routes do. Nothing is drawn or
 * rendered here; the app lays out and draws the model.
 */

/** A Descendant chart: 404 for an unknown start, 422 naming `line` when its end does not descend from the start. */
export async function descendantChartFor(deps: ChartDeps, q: DescendantChartQuery): Promise<DescendantChart> {
  let start: ChartStart;
  if (q.person !== undefined) {
    const kept = await keptPerson(deps.db, q.person);
    if (kept === null) throw new ApiProblem(404, 'not_found', 'No Person with this id.');
    start = { personId: kept };
  } else {
    const family = await deps.db.selectFrom('family').select('id').where('id', '=', q.family!).executeTakeFirst();
    if (!family) throw new ApiProblem(404, 'not_found', 'No Family with this id.');
    start = { familyId: family.id };
  }
  const line = q.line === undefined ? null : await keptPerson(deps.db, q.line);
  if (q.line !== undefined && line === null) throw notADescendant();
  // One generation more than shown, to know who has descendants below the last one; 12 for a Direct line.
  const depth = q.form === 'line' || line !== null ? Math.max(LINE_GENERATIONS, q.generations + 1) : q.generations + 1;
  const rows = await gatherDescendants(deps, start, depth);
  try {
    return descendantChart(rows, { start, generations: q.generations, form: q.form, line, sheet: q.sheet ?? null });
  } catch (error) {
    if (error instanceof NotADescendant) throw notADescendant();
    throw error;
  }
}

function notADescendant() {
  return new ApiProblem(422, 'not_a_descendant', `line: this Person does not descend from the start within ${LINE_GENERATIONS} generations.`);
}

/** A House chart: 404 for an unknown House. */
export async function houseChartFor(deps: ChartDeps, houseId: string, q: HouseChartQuery): Promise<HouseChart> {
  const rows = await gatherHouse(deps, houseId);
  if (rows === null) throw new ApiProblem(404, 'not_found', 'No House with this id.');
  return houseChart(rows, { from: q.from ?? null, to: q.to ?? null, unrelated: q.unrelated === 'true', sheet: q.sheet ?? null });
}
