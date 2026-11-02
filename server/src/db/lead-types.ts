import type { GapKind, LeadChangeKind, LeadStatus } from '@rodokmen/shared';
import type { ColumnType, Generated, Selectable } from 'kysely';

/** Research leads and suggested leads (migration 0009_research_leads): beside the Tree, written without review. */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;

/** A Research lead (research-leads spec). */
export interface LeadTable {
  id: Generated<string>;
  version: Generated<number>;
  created_at: CreatedAt;
  updated_at: Generated<Date>;
  question: string;
  reason: string;
  archive: string | null;
  source_id: string | null;
  years_from: number | null;
  years_to: number | null;
  pages: string | null;
  status: Generated<LeadStatus>;
  outcome: string | null;
  assignee_id: string | null;
  author_id: string;
  found_by_proposal_id: ColumnType<string | null, string | null | undefined, string | null>;
  suggestion_key: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface LeadLinkTable {
  id: Generated<string>;
  lead_id: string;
  person_id: string | null;
  place_id: string | null;
  sort_order: Generated<number>;
}

export interface LeadSearchTable {
  id: Generated<string>;
  lead_id: string;
  source_id: string | null;
  source_title: string | null;
  archive: string | null;
  years_from: number | null;
  years_to: number | null;
  pages: string | null;
  searched_on: string;
  searched_by: string;
  found: boolean;
  note: string | null;
  author_id: string;
  created_at: CreatedAt;
}

export interface LeadEventTable {
  id: Generated<number>;
  lead_id: string;
  at: Timestamp;
  author_id: string;
  kind: LeadChangeKind;
  proposal_id: string | null;
  fields: ColumnType<Array<{ field: string; before: unknown; after: unknown }>, string | undefined, string>;
}

export interface ProposalLeadTable {
  proposal_id: string;
  lead_id: string;
}

export interface LeadSuggestionTable {
  id: Generated<string>;
  key: string;
  kind: GapKind;
  person_id: string | null;
  family_id: string | null;
  source_id: string | null;
  place_id: string | null;
  archive: string | null;
  years_from: number | null;
  years_to: number | null;
  status: Generated<'open' | 'accepted' | 'dismissed'>;
  lead_id: string | null;
  decided_by: string | null;
  decided_at: Timestamp | null;
  computed_at: Timestamp;
}

export type Lead = Selectable<LeadTable>;
