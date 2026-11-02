import type { ReadingStatus } from '@rodokmen/shared';
import type { ColumnType, Generated } from 'kysely';

/** The tables of scan reading (migration 0009), apart from types.ts so that it stays readable. */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
type Json = ColumnType<Record<string, unknown>, string, string>;
type NullableJson = ColumnType<Record<string, unknown> | null, string | null, string | null>;
type JsonArray = ColumnType<unknown[], string, string>;

/** The Owner's switch and daily limit of scan reading: one row (migration 0009). */
export interface ScanReadingSettingTable {
  id: Generated<boolean>;
  enabled: Generated<boolean>;
  daily_limit: Generated<number>;
  changed_by: string | null;
  changed_at: Timestamp | null;
}

/** One reading of uploaded scans (scan-reading spec). */
export interface ReadingTable {
  id: Generated<string>;
  author_id: string;
  status: Generated<ReadingStatus>;
  upload_ids: string[];
  crops: JsonArray;
  context: Json;
  /** The Prague day it was asked for, which the daily limit counts. */
  day: string;
  model: string | null;
  result: NullableJson;
  error_code: string | null;
  error_message: string | null;
  usage: NullableJson;
  created_at: CreatedAt;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
}
