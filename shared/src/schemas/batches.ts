/**
 * Import batches (review spec, "Proposals in an Import batch build on each other", "Accept a whole
 * Import batch", "Batch view in the review queue") and the Vault importer's id map (vault-import
 * spec, "Re-runs submit only what is new").
 */
import { z } from 'zod';
import { Id, Version } from './common.js';
import { ProposalStatus } from './proposals.js';
import { AuthorRef } from './review.js';

const text = (max: number) => z.string().max(max);
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

export const CreateBatchBody = z
  .object({
    name: nonEmpty(200).describe('Named after the run, such as "Vault import 2026-11-02"'),
    vaultCommit: z
      .string()
      .regex(/^[0-9a-f]{7,64}$/)
      .nullable()
      .default(null)
      .describe('The commit of the Vault that was read'),
    note: text(4000).nullable().default(null),
  })
  .meta({ id: 'CreateBatchBody' });
export type CreateBatchBody = z.infer<typeof CreateBatchBody>;

export const BatchCounts = z
  .object({
    total: z.number().int(),
    pending: z.number().int().describe('Pending and not blocked'),
    blocked: z.number().int().describe('Pending, but building on a rejected Proposal'),
    accepted: z.number().int(),
    rejected: z.number().int(),
  })
  .meta({ id: 'BatchCounts' });

export const BatchView = z
  .object({
    id: Id,
    version: Version,
    name: z.string(),
    author: AuthorRef,
    createdAt: z.iso.datetime(),
    vaultCommit: z.string().nullable(),
    note: z.string().nullable(),
    counts: BatchCounts,
    pendingChanges: z.number().int().describe('Changes to records in the pending Proposals, for the confirmation before accepting the batch'),
  })
  .meta({ id: 'BatchView', description: 'An Import batch with its progress' });
export type BatchView = z.infer<typeof BatchView>;

export const BatchList = z.object({ items: z.array(BatchView) }).meta({ id: 'BatchList' });

export const BatchProposalsQuery = z.object({
  sample: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Instead of batch order: this many pending Proposals chosen at random, for spot-checking'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const AcceptBatchBody = z
  .object({
    proposals: z.number().int().min(1).describe('How many pending Proposals the confirmation stated; refused when the batch has changed since'),
    note: text(4000).nullable().default(null),
  })
  .meta({ id: 'AcceptBatchBody' });
export type AcceptBatchBody = z.infer<typeof AcceptBatchBody>;

export const AcceptBatchResult = z
  .object({
    accepted: z.array(Id).describe('Accepted, in batch order'),
    failed: z.array(z.object({ id: Id, position: z.number().int(), message: z.string() })).describe('Still pending: they could not be accepted'),
    blocked: z
      .array(z.object({ id: Id, position: z.number().int(), blockedBy: Id }))
      .describe('Still pending: they build on a Proposal that was rejected or failed'),
  })
  .meta({ id: 'AcceptBatchResult' });
export type AcceptBatchResult = z.infer<typeof AcceptBatchResult>;

// ---------------------------------------------------------------- the importer's id map

export const ImportMapEntry = z
  .object({
    key: nonEmpty(400).describe('The Vault key: a note path such as people/jan-novak-1801.md, or a record derived from notes'),
    kind: nonEmpty(40).describe('What the key stands for: note, person, event, family, citation …'),
    noteHash: z.string().max(128).nullable().default(null).describe('Hash of what the key was made from, to tell a changed note'),
    batchId: Id,
    proposalId: Id.nullable().default(null).describe('The Proposal that creates it'),
    tempId: z.string().max(60).nullable().default(null).describe('Its temporary id in that Proposal'),
    recordId: Id.nullable().default(null).describe('The record in the Tree, when known'),
  })
  .meta({ id: 'ImportMapEntry' });
export type ImportMapEntry = z.infer<typeof ImportMapEntry>;

export const PutImportMapBody = z.object({ entries: z.array(ImportMapEntry).min(1).max(2000) }).meta({ id: 'PutImportMapBody' });

export const ImportMapView = ImportMapEntry.safeExtend({
  proposalStatus: ProposalStatus.nullable(),
  recordId: Id.nullable().describe('The record in the Tree: set by the importer, or resolved once the Proposal that creates it is accepted'),
}).meta({ id: 'ImportMapView' });
export type ImportMapView = z.infer<typeof ImportMapView>;

export const ImportMapQuery = z.object({
  after: z.string().max(400).optional().describe('Keys after this one, for the next page'),
  limit: z.coerce.number().int().min(1).max(5000).default(5000),
});

export const ImportMap = z.object({ entries: z.array(ImportMapView), next: z.string().nullable() }).meta({ id: 'ImportMap' });
export type ImportMap = z.infer<typeof ImportMap>;
