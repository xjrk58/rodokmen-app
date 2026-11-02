import { exportedPersonLinks, type LeadView } from '@rodokmen/shared';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import { leadViews } from './views.js';

/**
 * Research leads as they may leave the server in an Export (research-leads design, "Erasure and
 * Exports"; exports spec, "Living people are reduced in every Export"). The Export itself is
 * built by add-exports-and-erasure; this is the entry it uses for leads.
 *
 * Every lead goes with its links to Places and to Persons who are not Living. Links to Living
 * people are dropped, and a lead about Living people only is left out (exportedPersonLinks in
 * shared/src/leads.ts, proved). Who is Living is the Living rule as of the clock, the one that
 * reduces Persons in the same Export. Search records go with their lead; who made them is a name
 * the Member wrote, never an account.
 */
export async function leadsForExport(db: Db, clock: Clock): Promise<LeadView[]> {
  const rows = await db.selectFrom('lead').selectAll().orderBy('created_at').orderBy('id').execute();
  const out: LeadView[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    for (const lead of await leadViews(db, clock, rows.slice(i, i + 200))) {
      const links = exportedPersonLinks(lead.persons.map((p) => ({ personId: p.id, living: p.living })));
      if (!links.include) continue;
      const kept = new Set(links.persons.map((p) => p.personId));
      out.push({ ...lead, persons: lead.persons.filter((p) => kept.has(p.id)) });
    }
  }
  return out;
}
