import type { AccountRole, UiLanguage } from '@rodokmen/shared';
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;

/** Members and Agents (migrations 0003 and 0006), with their own Person (0007) and a request to be linked to one (0017). */
export interface AccountTable {
  id: Generated<string>;
  version: Generated<number>;
  /** Null exactly for Agents. */
  email: string | null;
  display_name: string;
  language: UiLanguage;
  role: Generated<AccountRole>;
  disabled_at: Timestamp | null;
  invited_by: string | null;
  last_seen_at: Timestamp | null;
  outcome_emails: Generated<boolean>;
  /** The Person who is this Member in the Tree (set by the Owner). */
  person_id: string | null;
  /** The Person this Member asked to be linked to, and when; cleared when the Owner decides. */
  person_request_id: string | null;
  person_request_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Generated<Date>;
}
