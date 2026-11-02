/**
 * Payloads of the Proposal, review, history and upload routes (proposals, review,
 * tree-history and evidence-media specs).
 */
import { z } from 'zod';
import { LEAD_STATUSES } from '../leads.js';
import { Id, Version } from './common.js';
import { Operation, ProposalKind, ProposalStatus, RestorableTable } from './proposals.js';
import { Confidence, IMAGE_CONTENT_TYPES, ImageKind } from './tree.js';

const Sentence = z.object({ cs: z.string(), en: z.string() }).meta({ id: 'Sentence', description: 'The same sentence in Czech and English' });

export const AuthorRef = z.object({ id: Id, displayName: z.string(), isAgent: z.boolean().describe('True for an Agent account') }).meta({ id: 'AuthorRef' });

export const LeadStatus = z.enum(LEAD_STATUSES).meta({ id: 'LeadStatus', description: 'open, in_progress (someone is working on it), found or not_found' });
export type LeadStatus = z.infer<typeof LeadStatus>;

/** A Research lead named by a Proposal (research-leads spec, "Findings link back to leads"). */
export const LeadRef = z.object({ id: Id, question: z.string(), status: LeadStatus }).meta({ id: 'LeadRef' });

export const FieldConflict = z.object({ field: z.string(), proposed: z.unknown(), current: z.unknown() }).meta({ id: 'FieldConflict' });

export const ConflictView = z
  .object({
    record: z.string(),
    id: Id,
    label: Sentence,
    baseVersion: z.number().int(),
    currentVersion: z.number().int().nullable().describe('Null when the record no longer exists'),
    fields: z.array(FieldConflict).describe("For changed fields: the Proposal's value next to the current one"),
  })
  .meta({ id: 'ConflictView', description: 'The operation was based on an older version of the record' });

export const OperationView = z
  .object({
    position: z.number().int(),
    // The operation as it will be applied (with any Editor correction).
    operation: Operation,
    summary: Sentence,
    corrected: z.boolean(),
    // The author's operation, when an Editor corrected it.
    original: Operation.nullable(),
    originalSummary: Sentence.nullable(),
    current: z.record(z.string(), z.unknown()).nullable().describe('For changes to existing records: the current values of the fields it sets'),
    conflict: ConflictView.nullable(),
  })
  .meta({ id: 'OperationView' });

export const UploadStatus = z.enum(['waiting', 'ready', 'deleted']).meta({ id: 'UploadStatus' });
export type UploadStatus = z.infer<typeof UploadStatus>;

export const UploadView = z
  .object({
    id: Id,
    status: UploadStatus,
    contentType: z.enum(IMAGE_CONTENT_TYPES),
    byteSize: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    url: z.string().describe('Display copy (WebP); redirects to an expiring link'),
    fullUrl: z.string().describe('The original file; redirects to an expiring link'),
  })
  .meta({ id: 'UploadView' });

export const CitationPreview = z
  .object({
    ref: z.string().describe('Citation id, or the temporary id of a Citation the Proposal creates'),
    sourceTitle: z.string(),
    sourceType: z.string(),
    page: z.string().nullable(),
    transcription: z.string().nullable(),
    confidence: Confidence.nullable(),
    images: z.array(UploadView.safeExtend({ kind: ImageKind })),
  })
  .meta({ id: 'CitationPreview' });

export const ProposalView = z
  .object({
    id: Id,
    version: Version,
    kind: ProposalKind,
    status: ProposalStatus,
    author: AuthorRef,
    note: z.string().nullable(),
    submittedAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().nullable(),
    decidedBy: AuthorRef.nullable(),
    decisionNote: z.string().nullable().describe("The Editor's note, shown to the author"),
    undoes: Id.nullable(),
    undoneBy: Id.nullable(),
    operations: z.array(OperationView),
    citations: z.array(CitationPreview),
    conflicts: z.number().int().describe('Operations based on an older version of their record'),
    answersLeads: z.array(LeadRef).describe('The Research leads this finding answers; accepting marks them found'),
  })
  .meta({ id: 'ProposalView' });

export const ProposalList = z
  .object({ items: z.array(ProposalView), total: z.number().int().optional().describe('How many match in all, when the list is paged') })
  .meta({ id: 'ProposalList' });

export const ReviewQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const ProposalListQuery = z.object({
  status: ProposalStatus.optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
    .describe("Only your own Proposals (Editors see everyone's otherwise)"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const Resolution = z
  .object({
    position: z.number().int().min(0),
    fields: z
      .record(z.string(), z.enum(['proposal', 'current']))
      .default({})
      .describe("Per field: keep the Proposal's value or the current one"),
  })
  .meta({ id: 'Resolution' });

export const AcceptBody = z
  .object({
    note: z.string().max(4000).nullable().default(null),
    corrections: z
      .array(z.object({ position: z.number().int().min(0), operation: z.unknown() }))
      .max(300)
      .default([])
      .describe('Editor corrections: replacement operations'),
    resolutions: z.array(Resolution).max(300).default([]).describe('Choices for operations in conflict'),
  })
  .meta({ id: 'AcceptBody' });

export const RejectBody = z.object({ note: z.string().trim().max(4000).nullable().default(null) }).meta({ id: 'RejectBody' });

export const MergeBody = z
  .object({ mergeId: Id, keepBaseVersion: Version, mergeBaseVersion: Version, note: z.string().max(4000).nullable().default(null) })
  .meta({ id: 'MergeBody' });

export const LaterEdit = z
  .object({
    table: RestorableTable,
    id: Id,
    label: Sentence,
    recordLevel: z.boolean().describe('True when the undo would remove or bring back the whole record'),
    fields: z.array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown(), current: z.unknown() })),
  })
  .meta({ id: 'LaterEdit', description: 'A record touched again after the Proposal; the Editor chooses per field' });

export const UndoPreview = z
  .object({
    proposalId: Id,
    laterEdits: z.array(LaterEdit),
    blockedBy: z.array(z.string()).describe('Later accepted Proposals that attach records to ones this undo would remove; undo those first, newest first'),
  })
  .meta({ id: 'UndoPreview' });

export const UndoBody = z
  .object({
    note: z.string().max(4000).nullable().default(null),
    choices: z
      .array(z.object({ table: RestorableTable, id: Id, keep: z.boolean().optional(), fields: z.record(z.string(), z.enum(['undo', 'keep'])).default({}) }))
      .default([]),
  })
  .meta({ id: 'UndoBody' });

export const HistoryKind = z.enum(['person', 'name', 'family', 'event', 'source', 'citation']).meta({ id: 'HistoryKind' });

export const HistoryEntry = z
  .object({
    proposalId: Id,
    kind: ProposalKind,
    author: AuthorRef,
    acceptedBy: AuthorRef,
    acceptedAt: z.iso.datetime(),
    note: z.string().nullable(),
    decisionNote: z.string().nullable(),
    citations: z.array(z.object({ id: Id, sourceTitle: z.string(), page: z.string().nullable() })),
    summaries: z.array(Sentence),
    corrections: z.array(z.object({ position: z.number().int(), by: AuthorRef, summary: Sentence, original: Sentence })),
    changes: z.array(
      z.object({ table: z.string(), id: Id, before: z.record(z.string(), z.unknown()).nullable(), after: z.record(z.string(), z.unknown()).nullable() }),
    ),
    undoneBy: Id.nullable(),
  })
  .meta({ id: 'HistoryEntry' });

export const History = z.object({ items: z.array(HistoryEntry) }).meta({ id: 'History' });

export const CreateUploadBody = z
  .object({
    contentType: z.enum(IMAGE_CONTENT_TYPES),
    byteSize: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .meta({ id: 'CreateUploadBody' });

export const UploadTicket = z
  .object({
    upload: UploadView,
    putUrl: z.string().describe('Presigned PUT link into the pending/ prefix'),
    putHeaders: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: 'UploadTicket' });

export const NotificationSettings = z.object({ outcomeEmails: z.boolean() }).meta({ id: 'NotificationSettings' });

export type ProposalView = z.infer<typeof ProposalView>;
export type OperationView = z.infer<typeof OperationView>;
export type ConflictView = z.infer<typeof ConflictView>;
export type AuthorRef = z.infer<typeof AuthorRef>;
export type UploadView = z.infer<typeof UploadView>;
export type CitationPreview = z.infer<typeof CitationPreview>;
export type AcceptBody = z.infer<typeof AcceptBody>;
export type UndoBody = z.infer<typeof UndoBody>;
export type LaterEdit = z.infer<typeof LaterEdit>;
export type HistoryEntry = z.infer<typeof HistoryEntry>;
export type HistoryKind = z.infer<typeof HistoryKind>;
export type ProposalList = z.infer<typeof ProposalList>;
export type UndoPreview = z.infer<typeof UndoPreview>;
export type History = z.infer<typeof History>;
export type UploadTicket = z.infer<typeof UploadTicket>;
export type NotificationSettings = z.infer<typeof NotificationSettings>;
export type MergeBody = z.infer<typeof MergeBody>;
export type RejectBody = z.infer<typeof RejectBody>;
export type CreateUploadBody = z.infer<typeof CreateUploadBody>;
