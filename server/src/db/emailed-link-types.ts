import type { ColumnType, Generated } from 'kysely';

/**
 * The links Rodokmen emails to a Member's address: sign-in links (migration 0003) and the links
 * that confirm a new address (migration 0016, add-address-correction). Only each token's hash is stored.
 */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;

export interface SignInLinkTable {
  id: Generated<string>;
  token_hash: Buffer;
  account_id: string;
  created_at: CreatedAt;
  expires_at: Timestamp;
  used_at: Timestamp | null;
}

/** A change of a Member's address, waiting for the link sent to the new address (member-accounts spec, "The Owner corrects a Member's address"). */
export interface EmailChangeTable {
  id: Generated<string>;
  token_hash: Buffer;
  account_id: string;
  /** The new address, lowercased. */
  email: string;
  /** The Owner who asked for it. */
  requested_by: string;
  created_at: CreatedAt;
  expires_at: Timestamp;
  confirmed_at: Timestamp | null;
  revoked_at: Timestamp | null;
}
