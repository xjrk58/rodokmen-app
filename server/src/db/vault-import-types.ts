import type { ColumnType, Generated } from 'kysely';

/** Tables added by add-vault-import: Labels, Source documents, Import batches and the id map. */

interface RecordColumns {
  id: Generated<string>;
  version: Generated<number>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: Generated<Date>;
}

/** A Label of a Person (tree-model spec, "Labels on Persons"); `folded` is its search fold, unique per Person. */
export interface PersonLabelTable extends RecordColumns {
  person_id: string;
  label: string;
  folded: ColumnType<string, never, never>;
}
