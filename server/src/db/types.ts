import type {
  AccountRole,
  ChildLinkType,
  Confidence,
  EventType,
  ImageContentType,
  ImageKind,
  NameLanguage,
  NameType,
  PlaceType,
  ProposalKind,
  ProposalStatus,
  RestorableTable,
  RoleType,
  Sex,
  SourceType,
  UiLanguage,
  UploadStatus,
} from '@rodokmen/shared';
import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';
import type { Snapshot } from '../proposals/records.js';

/** ISO day 'YYYY-MM-DD', or 'infinity' / '-infinity' for open period ends. */
export type Day = string;
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
/** geography(Point, 4326): written with ST_MakePoint, read through ST_X / ST_Y. */
type Geography = ColumnType<unknown, unknown, unknown>;

interface RecordColumns {
  id: Generated<string>;
  version: Generated<number>;
  created_at: CreatedAt;
  updated_at: Generated<Date>;
}

interface PeriodColumns {
  period_from: string | null;
  period_to: string | null;
  valid_from: Generated<Day>;
  valid_to: Generated<Day>;
}

export interface PersonTable extends RecordColumns {
  sex: Generated<Sex>;
  /** Set when the Person was merged into another; the record stays as a redirect. */
  merged_into_id: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface NameTable extends RecordColumns {
  person_id: string;
  given: Generated<string>;
  surname: Generated<string>;
  type: NameType;
  as_found: string;
  is_primary: Generated<boolean>;
  sort_order: Generated<number>;
  search_text: ColumnType<string, never, never>;
}

export interface FamilyTable extends RecordColumns {
  partner1_id: string | null;
  partner2_id: string | null;
}

export interface FamilyChildTable extends RecordColumns {
  family_id: string;
  child_id: string;
  link_type: ChildLinkType;
  sort_order: Generated<number>;
}

export interface PlaceTable extends RecordColumns {
  type: Generated<PlaceType>;
  location: Geography | null;
  municipality_code: string | null;
  municipality_name: string | null;
}

export interface PlaceNameTable extends RecordColumns, PeriodColumns {
  place_id: string;
  name: string;
  language: NameLanguage;
  is_primary: Generated<boolean>;
  search_text: ColumnType<string, never, never>;
}

export interface HouseTable extends RecordColumns {
  place_id: string;
  location: Geography | null;
  note: string | null;
}

export interface HouseNumberTable extends RecordColumns, PeriodColumns {
  house_id: string;
  number: string;
}

export interface ParishTable extends RecordColumns {
  name: string;
  seat_place_id: string | null;
}

export interface PlaceParishTable extends RecordColumns, PeriodColumns {
  place_id: string;
  parish_id: string;
}

export interface EstateTable extends RecordColumns {
  name: string;
}

export interface PlaceEstateTable extends RecordColumns, PeriodColumns {
  place_id: string;
  estate_id: string;
}

export interface EventTable extends RecordColumns {
  type: EventType;
  type_detail: string | null;
  date: string | null;
  date_earliest: Day | null;
  date_latest: Day | null;
  place_id: string | null;
  house_id: string | null;
  description: string | null;
}

export interface EventRoleTable extends RecordColumns {
  event_id: string;
  person_id: string;
  role: RoleType;
  role_detail: string | null;
  sort_order: Generated<number>;
}

export interface SourceTable extends RecordColumns {
  type: SourceType;
  title: string;
  repository: string | null;
  reference: string | null;
  url: string | null;
  account_given_by: string | null;
  account_given_by_person_id: string | null;
  account_given_on: string | null;
}

export interface CitationTable extends RecordColumns {
  source_id: string;
  page: string | null;
  transcription: string;
  read_on: Day;
  confidence: Confidence;
  note: string | null;
}

export interface EventCitationTable extends RecordColumns {
  event_id: string;
  citation_id: string;
}

export interface NameCitationTable extends RecordColumns {
  name_id: string;
  citation_id: string;
}

export interface ImageTable extends RecordColumns {
  kind: ImageKind;
  citation_id: string | null;
  storage_key: string;
  content_type: ImageContentType;
  byte_size: number;
  width: number | null;
  height: number | null;
  sha256: string;
  caption: string | null;
  display_key: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface ImagePersonTable extends RecordColumns {
  image_id: string;
  person_id: string;
}

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
  created_at: CreatedAt;
  updated_at: Generated<Date>;
}

export interface SessionTable {
  id: Generated<string>;
  token_hash: Buffer;
  account_id: string;
  method: 'passkey' | 'email_link' | 'invitation';
  user_agent: string | null;
  created_at: CreatedAt;
  last_seen_at: Timestamp;
  expires_at: Timestamp;
  ended_at: Timestamp | null;
}

export interface PasskeyTable {
  id: Generated<string>;
  account_id: string;
  credential_id: string;
  public_key: Buffer;
  counter: ColumnType<number, number | undefined, number>;
  transports: ColumnType<string[], string[] | undefined, string[]>;
  device_type: string;
  backed_up: Generated<boolean>;
  name: string;
  created_at: CreatedAt;
  last_used_at: Timestamp | null;
}

export interface WebauthnChallengeTable {
  id: Generated<string>;
  challenge: string;
  purpose: 'registration' | 'authentication';
  account_id: string | null;
  created_at: CreatedAt;
  expires_at: Timestamp;
}

export interface InvitationTable {
  id: Generated<string>;
  token_hash: Buffer;
  email: string;
  language: UiLanguage;
  invited_by: string;
  created_at: CreatedAt;
  expires_at: Timestamp;
  accepted_at: Timestamp | null;
  accepted_account_id: string | null;
  revoked_at: Timestamp | null;
}

export interface SignInLinkTable {
  id: Generated<string>;
  token_hash: Buffer;
  account_id: string;
  created_at: CreatedAt;
  expires_at: Timestamp;
  used_at: Timestamp | null;
}

export interface AgentTokenTable {
  id: Generated<string>;
  account_id: string;
  token_hash: Buffer;
  prefix: string;
  label: string | null;
  created_by: string;
  created_at: CreatedAt;
  last_used_at: Timestamp | null;
  revoked_at: Timestamp | null;
}

export interface AgentRateWindowTable {
  account_id: string;
  kind: 'proposal' | 'read';
  window_start: Timestamp;
  count: number;
}

type Json = ColumnType<Record<string, unknown>, string, string>;
type NullableJson = ColumnType<Record<string, unknown> | null, string | null, string | null>;
/** A logged row (`to_jsonb(row)`), written as JSON text. */
type SnapshotJson = ColumnType<Snapshot | null, string | null, string | null>;

export interface ProposalTable {
  id: Generated<string>;
  version: Generated<number>;
  kind: Generated<ProposalKind>;
  status: Generated<ProposalStatus>;
  author_id: string;
  note: string | null;
  format_version: number;
  idempotency_key: string;
  submitted_at: Timestamp;
  decided_at: Timestamp | null;
  decided_by: string | null;
  decision_note: string | null;
  undoes_proposal_id: string | null;
  undone_by_proposal_id: string | null;
  created_at: CreatedAt;
  updated_at: Generated<Date>;
}

export interface ProposalOperationTable {
  proposal_id: string;
  position: number;
  op: string;
  operation: Json;
  target_table: string | null;
  target_id: string | null;
  base_version: number | null;
  corrected: NullableJson;
  corrected_by: string | null;
  corrected_at: Timestamp | null;
}

export interface LogEntryTable {
  id: Generated<string>;
  proposal_id: string;
  kind: ProposalKind;
  author_id: string;
  accepted_by: string;
  accepted_at: Timestamp;
  citation_ids: ColumnType<string[], string[] | undefined, never>;
  created_at: CreatedAt;
}

export interface LogChangeTable {
  id: Generated<number>;
  log_entry_id: string;
  seq: number;
  record_table: RestorableTable;
  record_id: string;
  before: SnapshotJson;
  after: SnapshotJson;
}

export interface UploadTable {
  id: Generated<string>;
  version: Generated<number>;
  author_id: string;
  status: Generated<UploadStatus>;
  storage_key: string;
  display_key: string;
  declared_type: ImageTable['content_type'];
  declared_size: number;
  declared_sha256: string;
  content_type: ImageTable['content_type'] | null;
  byte_size: number | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  proposal_id: string | null;
  image_id: string | null;
  orphaned_at: Timestamp | null;
  deleted_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Generated<Date>;
}

export interface JobRunTable {
  job: string;
  day: string;
  status: 'running' | 'done' | 'failed';
  attempts: Generated<number>;
  claimed_at: Timestamp;
  finished_at: Timestamp | null;
  detail: string | null;
}

export interface JobDeliveryTable {
  job: string;
  day: string;
  account_id: string;
  sent_at: Timestamp | null;
  attempts: Generated<number>;
  last_error: string | null;
}

export interface Database {
  person: PersonTable;
  name: NameTable;
  family: FamilyTable;
  family_child: FamilyChildTable;
  place: PlaceTable;
  place_name: PlaceNameTable;
  house: HouseTable;
  house_number: HouseNumberTable;
  parish: ParishTable;
  place_parish: PlaceParishTable;
  estate: EstateTable;
  place_estate: PlaceEstateTable;
  event: EventTable;
  event_role: EventRoleTable;
  source: SourceTable;
  citation: CitationTable;
  event_citation: EventCitationTable;
  name_citation: NameCitationTable;
  image: ImageTable;
  image_person: ImagePersonTable;
  account: AccountTable;
  session: SessionTable;
  passkey: PasskeyTable;
  webauthn_challenge: WebauthnChallengeTable;
  invitation: InvitationTable;
  sign_in_link: SignInLinkTable;
  agent_token: AgentTokenTable;
  agent_rate_window: AgentRateWindowTable;
  proposal: ProposalTable;
  proposal_operation: ProposalOperationTable;
  log_entry: LogEntryTable;
  log_change: LogChangeTable;
  upload: UploadTable;
  job_run: JobRunTable;
  job_delivery: JobDeliveryTable;
}

export type Proposal = Selectable<ProposalTable>;
export type Upload = Selectable<UploadTable>;

export type Account = Selectable<AccountTable>;
export type NewEvent = Insertable<EventTable>;
