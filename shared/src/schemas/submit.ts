/**
 * The body of a submitted Proposal (proposals spec): its operations, the version of the operation
 * set they were written for, the Draft's idempotency key, the Research leads it answers
 * (research-leads spec, "Findings link back to leads"), and, for a Proposal drafted from scan
 * readings, which readings and which values are still "read by AI" (scan-reading spec).
 */
import { z } from 'zod';
import { Id } from './common.js';
import { OPERATIONS_VERSION } from './proposals.js';
import { ReaderInfo } from './reading.js';

const text = (max: number) => z.string().max(max);

export const SubmitProposalBody = z
  .object({
    formatVersion: z.literal(OPERATIONS_VERSION).describe('Version of the operation set the Proposal was written for'),
    idempotencyKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,100}$/)
      .describe('One key per Draft: a retried submit returns the same Proposal'),
    note: text(4000).nullable().default(null).describe("What the finding is, in the author's words"),
    direct: z.boolean().default(false).describe('Editors only: accept at once (a direct change)'),
    operations: z.array(z.unknown()).min(1).max(300),
    answersLeads: z
      .array(Id)
      .max(20)
      .default([])
      .refine((ids) => new Set(ids).size === ids.length, { message: 'name each lead once' })
      .describe('The Research leads this finding answers: accepting the Proposal marks them found, undoing it reopens them'),
    reader: ReaderInfo.nullable()
      .default(null)
      .describe('Drafted from scan readings: which, and which values are still as read ("read by AI"). New Citations then have at most normal confidence'),
  })
  .meta({ id: 'SubmitProposalBody' });
export type SubmitProposalBody = z.infer<typeof SubmitProposalBody>;
