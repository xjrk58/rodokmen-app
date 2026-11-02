/**
 * Research leads, search records and suggested leads (research-leads spec). A lead is a plan,
 * not a fact: Members and Agents write it directly, without review, and every change is kept in
 * its history with author and time. A suggested lead comes from the gap finder and waits, apart
 * from the leads, until a Member accepts or dismisses it.
 */
import { z } from 'zod';
import { PersonSummary, PlaceRef } from './api.js';
import { EdtfDate, Id, Version } from './common.js';
import { AuthorRef, LeadStatus } from './review.js';
import { Year } from './tree.js';

const text = (max: number) => z.string().max(max);
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

const Sentence = z.object({ cs: z.string(), en: z.string() });

/** Years to check or that were checked: a single year has `from` equal to `to`. */
export const YearRange = z
  .object({ from: Year, to: Year })
  .refine((y) => y.from <= y.to, { message: 'the years end before they start', path: ['to'] })
  .meta({ id: 'YearRange' });

/** The register Source a lead or a search names, as a lead shows it. */
export const LeadSource = z
  .object({ id: Id, title: z.string(), repository: z.string().nullable(), reference: z.string().nullable() })
  .meta({ id: 'LeadSource' });

// ---------------------------------------------------------------- search records

/**
 * One attempt on a lead (research-leads spec, "What was searched is recorded"): which Source or
 * archive, the years and pages looked at, when and by whom, and what was found, including nothing.
 */
export const SearchRecordBody = z
  .object({
    sourceId: Id.nullable().default(null).describe('The register Source looked at'),
    archive: text(400).nullable().default(null).describe('The archive, when no Source of the Tree names it'),
    years: YearRange.nullable().default(null).describe('The years looked at'),
    pages: text(200).nullable().default(null).describe('The pages or frames looked at, such as 1–60'),
    searchedOn: EdtfDate.optional().describe('When the search was made (EDTF); today when left out'),
    searchedBy: nonEmpty(200).optional().describe('Who looked; the author when left out'),
    found: z.boolean().describe('Whether the search found what the lead asks'),
    note: text(4000).nullable().default(null).describe('What was found, or what was seen instead'),
  })
  .refine((r) => r.sourceId !== null || (r.archive !== null && r.archive.trim() !== ''), {
    message: 'name the Source or the archive that was searched',
    path: ['sourceId'],
  })
  .meta({ id: 'SearchRecordBody' });
export type SearchRecordBody = z.infer<typeof SearchRecordBody>;

export const SearchRecordView = z
  .object({
    id: Id,
    source: LeadSource.nullable(),
    archive: z.string().nullable(),
    years: YearRange.nullable(),
    pages: z.string().nullable(),
    searchedOn: z.string().describe('EDTF date'),
    searchedBy: z.string(),
    found: z.boolean(),
    note: z.string().nullable(),
    author: AuthorRef.describe('Who recorded it'),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'SearchRecordView' });

// ---------------------------------------------------------------- leads

const LeadFields = {
  question: nonEmpty(1000).describe('The question, such as "Find Jan’s baptism"'),
  reason: nonEmpty(4000).describe('Why, and what is known so far'),
  archive: text(400).nullable().describe('The archive to look in'),
  sourceId: Id.nullable().describe('The register Source to check'),
  years: YearRange.nullable().describe('The years to check'),
  pages: text(200).nullable().describe('The pages or frames to check'),
  personIds: z.array(Id).max(50).describe('The Persons the lead concerns'),
  placeIds: z.array(Id).max(50).describe('The Places the lead concerns'),
  assigneeId: Id.nullable().describe('The Member or Agent working on it'),
  outcome: text(4000).nullable().describe('What came of it'),
};

const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;

export const CreateLeadBody = z
  .object({
    question: LeadFields.question,
    reason: LeadFields.reason,
    archive: LeadFields.archive.default(null),
    sourceId: LeadFields.sourceId.default(null),
    years: LeadFields.years.default(null),
    pages: LeadFields.pages.default(null),
    personIds: LeadFields.personIds.default([]),
    placeIds: LeadFields.placeIds.default([]),
    assigneeId: LeadFields.assigneeId.default(null),
    outcome: LeadFields.outcome.default(null),
    status: LeadStatus.default('open').describe('not_found needs at least one search record'),
    searches: z.array(SearchRecordBody).max(50).default([]).describe('Searches already made, recorded with the lead'),
  })
  .refine((b) => unique(b.personIds), { message: 'name each Person once', path: ['personIds'] })
  .refine((b) => unique(b.placeIds), { message: 'name each Place once', path: ['placeIds'] })
  .meta({ id: 'CreateLeadBody', description: 'A new Research lead; written at once, without review' });
export type CreateLeadBody = z.infer<typeof CreateLeadBody>;

export const UpdateLeadBody = z
  .object({
    baseVersion: Version.describe('The version of the lead you saw; a lead changed since answers 409'),
    question: LeadFields.question.optional(),
    reason: LeadFields.reason.optional(),
    archive: LeadFields.archive.optional(),
    sourceId: LeadFields.sourceId.optional(),
    years: LeadFields.years.optional(),
    pages: LeadFields.pages.optional(),
    personIds: LeadFields.personIds.optional(),
    placeIds: LeadFields.placeIds.optional(),
    assigneeId: LeadFields.assigneeId.optional(),
    outcome: LeadFields.outcome.optional(),
    status: LeadStatus.optional().describe('not_found needs at least one search record'),
  })
  .refine((b) => Object.keys(b).some((k) => k !== 'baseVersion'), { message: 'change at least one field' })
  .refine((b) => b.personIds === undefined || unique(b.personIds), { message: 'name each Person once', path: ['personIds'] })
  .refine((b) => b.placeIds === undefined || unique(b.placeIds), { message: 'name each Place once', path: ['placeIds'] })
  .meta({ id: 'UpdateLeadBody', description: 'Changes fields of a lead; written at once, without review' });
export type UpdateLeadBody = z.infer<typeof UpdateLeadBody>;

export const CloseLeadBody = z
  .object({
    baseVersion: Version,
    status: z.enum(['found', 'not_found']),
    outcome: text(4000).nullable().default(null).describe('What came of it'),
    search: SearchRecordBody.optional().describe('The search that closes it, recorded with the closing'),
  })
  .meta({ id: 'CloseLeadBody', description: 'Closes a lead as found or not found; not found needs at least one search record' });
export type CloseLeadBody = z.infer<typeof CloseLeadBody>;

export const LeadView = z
  .object({
    id: Id,
    version: Version,
    question: z.string(),
    reason: z.string(),
    archive: z.string().nullable(),
    source: LeadSource.nullable(),
    years: YearRange.nullable(),
    pages: z.string().nullable(),
    status: LeadStatus,
    outcome: z.string().nullable(),
    persons: z.array(PersonSummary).describe('A Person merged into another shows as the one kept'),
    places: z.array(PlaceRef),
    assignee: AuthorRef.nullable().describe('Who is working on it'),
    author: AuthorRef.describe('Who wrote it'),
    foundBy: Id.nullable().describe('The accepted Proposal that answered it'),
    fromSuggestion: z.string().nullable().describe('The key of the suggested lead it was accepted from'),
    searches: z.array(SearchRecordView).describe('Every search made, newest first'),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'LeadView' });
export type LeadView = z.infer<typeof LeadView>;

export const LeadChangeKind = z
  .enum(['created', 'edited', 'searched', 'closed', 'answered', 'reopened'])
  .meta({ id: 'LeadChangeKind', description: 'What a change of a lead did' });

export const LeadChange = z
  .object({
    at: z.iso.datetime(),
    author: AuthorRef,
    kind: LeadChangeKind,
    proposalId: Id.nullable().describe('For answered and reopened: the Proposal accepted or undone'),
    fields: z.array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() })),
  })
  .meta({ id: 'LeadChange' });

export const LeadDetail = LeadView.safeExtend({
  history: z.array(LeadChange).describe('Every change, newest first, with author and time'),
}).meta({ id: 'LeadDetail' });
export type LeadDetail = z.infer<typeof LeadDetail>;

const isStatus = (v: string): v is LeadStatus => LeadStatus.safeParse(v).success;

/** A comma-separated list of statuses, such as open,in_progress. */
const StatusFilter = z
  .string()
  .transform((v, ctx) => {
    const parts = [...new Set(v.split(',').map((p) => p.trim()))];
    const bad = parts.filter((p) => !isStatus(p));
    if (bad.length) ctx.addIssue({ code: 'custom', message: `unknown status ${bad.join(', ')}` });
    return parts.filter(isStatus);
  })
  .describe('Only leads with these statuses, such as open,in_progress');

export const LeadListQuery = z.object({
  status: StatusFilter.optional(),
  personId: Id.optional().describe('Only leads about this Person'),
  placeId: Id.optional().describe('Only leads about this Place'),
  archive: z.string().trim().min(1).max(400).optional().describe('Only leads to look in this archive (its name, or the repository of their register)'),
  assigneeId: Id.optional().describe('Only leads this Member or Agent is working on'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const LeadList = z
  .object({ items: z.array(LeadView), total: z.number().int(), limit: z.number().int(), offset: z.number().int() })
  .meta({ id: 'LeadList', description: 'Open and in-progress leads first, then the rest, newest first' });

// ---------------------------------------------------------------- suggested leads

export const GapKind = z
  .enum(['birth', 'parents', 'marriage'])
  .meta({ id: 'GapKind', description: 'No birth or baptism Citation; unknown parents with a known Parish and years; a marriage without a Citation' });

export const SuggestionStatus = z.enum(['open', 'accepted', 'dismissed']).meta({ id: 'SuggestionStatus' });

export const LeadSuggestion = z
  .object({
    id: Id,
    key: z.string().describe('Stable: the kind of gap, the Person or Family, and the register Source'),
    kind: GapKind,
    status: SuggestionStatus,
    person: PersonSummary.nullable().describe('The Relative it is about (for a marriage, a Relative partner)'),
    familyId: Id.nullable().describe('For a marriage: the Family'),
    partners: z.array(PersonSummary).describe('For a marriage: both partners'),
    place: PlaceRef.nullable().describe('Where the birth, baptism or marriage was, when known'),
    source: LeadSource.nullable().describe('The register to check, when the Tree holds one that fits'),
    archive: z.string().nullable().describe('The archive to look in: the register’s, or the one that holds the Place’s registers'),
    years: YearRange.nullable().describe('The years to check'),
    question: Sentence.describe('The lead it suggests, in Czech and English'),
    reason: Sentence,
    leadId: Id.nullable().describe('The lead it became, once accepted'),
  })
  .meta({ id: 'LeadSuggestion' });
export type LeadSuggestion = z.infer<typeof LeadSuggestion>;

export const SuggestionListQuery = z.object({
  personId: Id.optional().describe('Only suggestions about this Person'),
  placeId: Id.optional().describe('Only suggestions at this Place'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const SuggestionList = z
  .object({ items: z.array(LeadSuggestion), total: z.number().int(), limit: z.number().int(), offset: z.number().int() })
  .meta({ id: 'SuggestionList', description: 'Open suggested leads, shown apart from the leads until a Member accepts or dismisses them' });

export type YearRange = z.infer<typeof YearRange>;
/** What a client sends: fields with defaults may be left out. */
export type CreateLeadInput = z.input<typeof CreateLeadBody>;
export type UpdateLeadInput = z.input<typeof UpdateLeadBody>;
export type SearchRecordInput = z.input<typeof SearchRecordBody>;
export type CloseLeadInput = z.input<typeof CloseLeadBody>;
export type LeadSource = z.infer<typeof LeadSource>;
export type SearchRecordView = z.infer<typeof SearchRecordView>;
export type LeadChange = z.infer<typeof LeadChange>;
export type LeadChangeKind = z.infer<typeof LeadChangeKind>;
export type LeadList = z.infer<typeof LeadList>;
export type LeadListQuery = z.infer<typeof LeadListQuery>;
export type GapKind = z.infer<typeof GapKind>;
export type SuggestionList = z.infer<typeof SuggestionList>;
export type SuggestionListQuery = z.infer<typeof SuggestionListQuery>;
