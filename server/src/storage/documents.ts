import { createHash } from 'node:crypto';
import { DOCUMENT_MAX_BYTES, type DocumentContentType } from '@rodokmen/shared';
import { ApiProblem } from '../auth/problem.js';

/**
 * Documents on Sources (evidence-media spec, "Documents on Sources"): a PDF of up to 50 MB, or
 * the DOC a PDF was converted from (Word 97–2003, an OLE2 compound file). The type comes from the
 * file's first bytes; the declared one is not trusted. A document has no display copy.
 */
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export const DOCUMENT_TOO_LARGE_MESSAGE = 'Documents can be at most 50 MB. Save a smaller copy, for example with fewer dots per inch.';
export const NOT_A_PDF_MESSAGE = 'Only PDF documents can be attached. Save the document as a PDF first.';

/** The document type of a file from its first bytes, or null. */
export function sniffDocumentType(buf: Buffer): DocumentContentType | null {
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(OLE2)) return 'application/msword';
  return null;
}

export interface CheckedDocument {
  contentType: DocumentContentType;
  byteSize: number;
  sha256: string;
}

/** Checks an uploaded document: its size, and that it is the type it was announced as. */
export function checkDocument(original: Buffer, declared: DocumentContentType): CheckedDocument {
  if (original.length > DOCUMENT_MAX_BYTES) throw new ApiProblem(413, 'too_large', DOCUMENT_TOO_LARGE_MESSAGE);
  const contentType = sniffDocumentType(original);
  if (contentType !== declared) {
    throw new ApiProblem(415, 'unsupported_document', declared === 'application/pdf' ? NOT_A_PDF_MESSAGE : 'This file is not a Word 97–2003 document (DOC).');
  }
  return { contentType, byteSize: original.length, sha256: createHash('sha256').update(original).digest('hex') };
}
