import { sql } from 'kysely';
import type { Db } from '../db/db.js';

/** What the views of batch Proposals show: what they build on, and whether they are blocked (review spec). */

/**
 * The pending Proposals that are blocked (review spec, "Rejected foundation"): they build, directly
 * or through others, on a rejected Proposal. Maps each to a rejected Proposal it builds on.
 */
export async function blockedProposals(db: Db, where: { batchId: string } | { proposalIds: readonly string[] }): Promise<Map<string, string>> {
  if ('proposalIds' in where && where.proposalIds.length === 0) return new Map();
  const filter = 'batchId' in where ? sql`p.batch_id = ${where.batchId}` : sql`p.id = any(${[...where.proposalIds]}::uuid[])`;
  const { rows } = await sql<{ id: string; root: string }>`
    with recursive blocked (proposal_id, root) as (
      select d.proposal_id, d.depends_on_id from proposal_dependency d join proposal r on r.id = d.depends_on_id where r.status = 'rejected'
      union
      select d.proposal_id, b.root from proposal_dependency d join blocked b on d.depends_on_id = b.proposal_id
    )
    select b.proposal_id as id, min(b.root::text) as root from blocked b join proposal p on p.id = b.proposal_id
    where p.status = 'pending' and ${filter}
    group by b.proposal_id`.execute(db);
  return new Map(rows.map((r) => [r.id, r.root]));
}

/** The dependencies of some Proposals, in one query. */
export async function dependenciesOf(db: Db, proposalIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (proposalIds.length === 0) return out;
  for (const d of await db
    .selectFrom('proposal_dependency')
    .selectAll()
    .where('proposal_id', 'in', [...proposalIds])
    .orderBy('depends_on_id')
    .execute())
    out.set(d.proposal_id, [...(out.get(d.proposal_id) ?? []), d.depends_on_id]);
  return out;
}
