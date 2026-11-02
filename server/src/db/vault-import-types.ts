import type { UploadContentType, UploadStatus } from '@rodokmen/shared';
import type { ColumnType, Generated } from 'kysely';

/** Tables added or changed by add-vault-import: Labels, uploads with documents, Source documents, Import batches and the id map. */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

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

/** A document of a Source (evidence-media spec, "Documents on Sources"): its PDF and, when converted, the original DOC. */
export interface SourceDocumentTable extends RecordColumns {
  source_id: string;
  title: string;
  storage_key: string;
  content_type: 'application/pdf';
  byte_size: number;
  sha256: string;
  original_key: string | null;
  original_content_type: 'application/msword' | null;
  original_byte_size: number | null;
  original_sha256: string | null;
}

/** An image or document on its way in (evidence-media spec); see migrations 0004 and 0012. */
export interface UploadTable {
  id: Generated<string>;
  version: Generated<number>;
  author_id: string;
  status: Generated<UploadStatus>;
  storage_key: string;
  display_key: string;
  declared_type: UploadContentType;
  declared_size: number;
  declared_sha256: string;
  /** An image, or a document (add-vault-import task 1.6). */
  kind: Generated<'image' | 'document'>;
  content_type: UploadContentType | null;
  byte_size: number | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  proposal_id: string | null;
  image_id: string | null;
  document_id: Generated<string | null>;
  orphaned_at: Timestamp | null;
  deleted_at: Timestamp | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: Generated<Date>;
}
