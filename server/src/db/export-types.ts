import type { ColumnType } from 'kysely';

/** Tables added by add-exports-and-erasure (migration 0015). */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/** An erased Person's id and when (erasure spec, "Restores keep erased people erased"). */
export interface ErasureTable {
  person_id: string;
  erased_at: Timestamp;
  /** When the Export's history was replaced after this erasure; null until then. */
  export_replaced_at: Timestamp | null;
}

/** The slug of an exported record, kept once given (exports design, "Export layout"). */
export interface ExportSlugTable {
  record_id: string;
  kind: 'person' | 'family' | 'place' | 'house' | 'parish' | 'estate' | 'source' | 'lead';
  slug: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}
