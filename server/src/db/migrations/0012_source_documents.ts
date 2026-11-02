import { type Kysely, sql } from 'kysely';

/**
 * Documents on Sources (evidence-media spec, "Documents on Sources"; add-vault-import task 1.6):
 * PDF files of up to 50 MB, such as a family chronicle or a certificate, attached to a Source as
 * part of a Proposal. Like images, they are private: served only through links that expire, and
 * never part of an Export.
 *
 * - upload.kind: an image, or a document. A document upload is a PDF, or (through the API only,
 *   for the Vault importer) the original DOC file a PDF was converted from. It has no display
 *   copy, and up to 50 MB.
 * - source_document: an accepted document of a Source: its PDF, and the original it was
 *   converted from when there is one, each with its size and SHA-256. A Tree record, so it is
 *   logged and undone with its Proposal.
 * - upload.document_id: the accepted document an upload became (as image_id for images).
 *
 * Works with the previous release still running: its uploads are images, the column defaults.
 */
export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
create table source_document (
  id uuid primary key default uuid_generate_v7(),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_id uuid not null references source (id),
  title text not null check (length(trim(title)) > 0),
  storage_key text not null unique,
  content_type text not null check (content_type = 'application/pdf'),
  byte_size bigint not null check (byte_size > 0 and byte_size <= ${DOCUMENT_MAX_BYTES}),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  original_key text unique,
  original_content_type text check (original_content_type = 'application/msword'),
  original_byte_size bigint check (original_byte_size > 0 and original_byte_size <= ${DOCUMENT_MAX_BYTES}),
  original_sha256 text check (original_sha256 ~ '^[0-9a-f]{64}$'),
  constraint source_document_original check (
    (original_key is null) = (original_content_type is null)
    and (original_key is null) = (original_byte_size is null)
    and (original_key is null) = (original_sha256 is null))
);
create index source_document_source_idx on source_document (source_id);
create trigger source_document_bump_version before update on source_document for each row execute function rdk_bump_version();

alter table upload add column kind text not null default 'image' check (kind in ('image', 'document'));
alter table upload add column document_id uuid references source_document (id) on delete set null;
alter table upload drop constraint upload_content_type_check;
alter table upload add constraint upload_content_type_check check (
  content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'application/msword'));
alter table upload drop constraint upload_byte_size_check;
alter table upload add constraint upload_byte_size_check check (byte_size > 0 and byte_size <= ${DOCUMENT_MAX_BYTES});
alter table upload add constraint upload_kind_size check (kind = 'document' or byte_size is null or byte_size <= 26214400);
alter table upload add constraint upload_kind_type check (
  content_type is null or (kind = 'document') = (content_type in ('application/pdf', 'application/msword')));
`,
    )
    .execute(db);
}

/** Drops the documents (their files stay in storage) and document uploads. */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
delete from upload where kind = 'document';
alter table upload drop constraint upload_kind_type;
alter table upload drop constraint upload_kind_size;
alter table upload drop constraint upload_byte_size_check;
alter table upload add constraint upload_byte_size_check check (byte_size > 0 and byte_size <= 26214400);
alter table upload drop constraint upload_content_type_check;
alter table upload add constraint upload_content_type_check check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'));
alter table upload drop column document_id;
alter table upload drop column kind;
drop table source_document;
`,
    )
    .execute(db);
}
