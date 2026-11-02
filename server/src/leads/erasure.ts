import { exportedPersonLinks } from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Db } from '../db/db.js';

/**
 * What erasing a Living person does to Research leads (research-leads design, "Erasure and
 * Exports"). Erasure itself is built by add-exports-and-erasure: it calls this in its own
 * transaction, before it deletes the Person.
 *
 * A lead that concerned only the erased Person is deleted, with its search records and history.
 * Every other lead loses its link to them, and the entries of its history that name them become
 * a marker that says something was erased, without their data. Their suggested leads go too. The
 * rule is exportedPersonLinks (shared/src/leads.ts, proved), with "Living" meaning the erased Person.
 */
export async function eraseFromLeads(tx: Db, personId: string): Promise<{ deleted: number; unlinked: number }> {
  const linked = await tx.selectFrom('lead_link').select('lead_id').where('person_id', '=', personId).execute();
  const leadIds = [...new Set(linked.map((l) => l.lead_id))];
  let deleted = 0;
  for (const leadId of leadIds) {
    const persons = await tx.selectFrom('lead_link').select('person_id').where('lead_id', '=', leadId).where('person_id', 'is not', null).execute();
    const kept = exportedPersonLinks(persons.map((p) => ({ personId: p.person_id!, living: p.person_id === personId })));
    if (!kept.include) {
      await tx.deleteFrom('lead').where('id', '=', leadId).execute();
      deleted += 1;
    }
  }
  const unlinked = await tx.deleteFrom('lead_link').where('person_id', '=', personId).executeTakeFirst();
  await tx
    .updateTable('lead_event')
    .set({ fields: JSON.stringify([{ field: 'erased', before: null, after: null }]) })
    .where(sql<boolean>`fields::text like ${`%${personId}%`}`)
    .execute();
  await tx
    .deleteFrom('lead_suggestion')
    .where((eb) => eb.or([eb('person_id', '=', personId), eb('key', 'like', `%:${personId}:%`)]))
    .execute();
  return { deleted, unlinked: Number(unlinked.numDeletedRows) };
}
