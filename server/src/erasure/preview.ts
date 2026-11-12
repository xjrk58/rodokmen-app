import { exportedPersonLinks, type ErasurePreview, type OwnedRow } from '@rodokmen/shared';
import type { Db } from '../db/db.js';
import { eventSummaries, personSummaries } from '../tree/summaries.js';
import { erasedIds, findPerson, mentioningChanges, mentioningProposals, planErasure } from './plan.js';
import type { ErasureDeps } from './service.js';

/**
 * What erasing a Person would remove, for the Owner to read before confirming (erasure spec,
 * "Owner erases a Living person"; the design's risk "Erasure removes evidence other people relied
 * on"): the same plan the erasure runs, counted, with the Events that disappear.
 */
export async function erasurePreview(deps: ErasureDeps, personId: string): Promise<ErasurePreview> {
  const { db, clock } = deps;
  await findPerson(db, personId);
  const plan = await planErasure(db, personId, clock.now());
  const summary = (await personSummaries(db, [personId], clock)).get(personId)!;
  const ids = erasedIds(plan);
  const changes = await mentioningChanges(db, ids);
  const viaLog = changes.length
    ? await db
        .selectFrom('log_entry')
        .select('proposal_id')
        .where('id', 'in', [...new Set(changes.map((c) => c.log_entry_id))])
        .execute()
    : [];
  const proposalIds = new Set([...viaLog.map((l) => l.proposal_id), ...(await mentioningProposals(db, ids))]);
  const pending = proposalIds.size
    ? await db
        .selectFrom('proposal')
        .select('id')
        .where('id', 'in', [...proposalIds])
        .where('status', '=', 'pending')
        .execute()
    : [];
  const leadIds = [...new Set((await db.selectFrom('lead_link').select('lead_id').where('person_id', 'in', plan.personIds).execute()).map((l) => l.lead_id))];
  let deleted = 0;
  for (const leadId of leadIds) {
    const links = await db.selectFrom('lead_link').select('person_id').where('lead_id', '=', leadId).where('person_id', 'is not', null).execute();
    if (!exportedPersonLinks(links.map((l) => ({ personId: l.person_id!, living: plan.personIds.includes(l.person_id!) }))).include) deleted += 1;
  }
  const count = (table: OwnedRow['table']) => plan.rows.filter((r) => r.table === table).length;
  return {
    person: summary,
    mayErase: plan.living,
    confirmWith: plan.name,
    names: count('name'),
    roles: count('event_role'),
    familyLinks: count('family_child') + (await partnerLinks(db, plan.personIds)),
    labels: count('person_label'),
    events: await eventSummaries(db, plan.events),
    citations: plan.citations.length,
    images: plan.images.length,
    families: plan.families.length,
    leads: { deleted, unlinked: leadIds.length - deleted },
    history: proposalIds.size,
    pending: pending.length,
  };
}

async function partnerLinks(db: Db, personIds: string[]): Promise<number> {
  const rows = await db
    .selectFrom('family')
    .select('id')
    .where((eb) => eb.or([eb('partner1_id', 'in', personIds), eb('partner2_id', 'in', personIds)]))
    .execute();
  return rows.length;
}
