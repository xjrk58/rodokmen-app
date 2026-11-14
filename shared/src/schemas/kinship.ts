/**
 * Kinship as data (kinship spec, "Kinship as data"; design.md, "The Kinship model"): the paths
 * between two Persons with their line, degree, marks and terms in every Interface language, and the
 * short form that Person summaries carry for a Member with an own Person. The answer of the route,
 * with the Persons it names, is in kinship-api.ts.
 */
import { z } from 'zod';
import { Id } from './common.js';
import { ChildLinkType } from './tree.js';

/** A term as written in one language, with its grammatical gender: null for a combined form such as "bratranec/sestřenice". */
export const KinshipTermText = z
  .object({ text: z.string(), gender: z.enum(['m', 'f', 'n']).nullable() })
  .meta({ id: 'KinshipTermText', description: 'A kinship term as written, nominative and alone, with its grammatical gender' });

/** The term in every Interface language: an answer missing one is refused. */
export const KinshipTerm = z
  .object({ cs: KinshipTermText, en: KinshipTermText })
  .strict()
  .meta({ id: 'KinshipTerm', description: 'The kinship term in every Interface language' });

export const KinshipKind = z
  .enum(['self', 'partner', 'birth', 'marriage', 'stepSibling', 'coParentInLaw', 'foster'])
  .meta({
    id: 'KinshipKind',
    description: 'The kind of path: the reader, a partner, by birth (adoption included), by marriage, a step-sibling, a co-parent-in-law, or a foster pair',
  });

export const KinshipLine = z
  .enum(['direct', 'collateral'])
  .nullable()
  .meta({
    id: 'KinshipLine',
    description: 'The line of kinship as the Czech civil code counts it (§ 772, and § 774 for kinship by marriage); null for the kinds with no degree',
  });

export const KinshipStep = z
  .object({
    person: Id.describe('The next Person on the path'),
    link: z.enum(['parent', 'child', 'partner']).describe('The next Person is a parent, a child or a partner of the one before'),
    linkType: ChildLinkType.nullable().describe('The type of the child link; null for a partner link'),
    weak: z.boolean().describe('The link has no Citation of normal or higher confidence'),
    recordId: Id.describe('The Family of a partner link, the child link of a parent or child link'),
  })
  .meta({ id: 'KinshipStep' });

export const KinshipPath = z
  .object({
    kind: KinshipKind,
    line: KinshipLine,
    degree: z
      .number()
      .int()
      .min(1)
      .nullable()
      .describe('The degree as the Czech civil code counts it: births between the two, or of the kin married into; null for the kinds with none'),
    up: z.number().int().min(0).describe('Generations up from the reader to the common ancestors (of the part by birth)'),
    down: z.number().int().min(0).describe('Generations down from the common ancestors to the Person (of the part by birth)'),
    half: z.boolean().describe('Half kinship: one common ancestor reached through two couples'),
    adoptive: z.boolean().describe('An adoptive child link on the way'),
    possible: z.boolean().describe('A link on the way has no Citation of normal or higher confidence'),
    commonAncestors: z.array(Id).max(2).describe('One Person, the two partners of one Family, or none'),
    steps: z.array(KinshipStep).describe('From the reader to the Person, each step to the next Person'),
    term: KinshipTerm,
  })
  .meta({ id: 'KinshipPath' });

export const KinshipConnection = z
  .object({
    steps: z.array(KinshipStep).min(1).describe('The shortest chain of any Family links, from the reader to the Person'),
    marriages: z.number().int().min(0).describe('How many partner links the chain holds'),
  })
  .meta({ id: 'KinshipConnection', description: 'With no kinship, how the two are connected' });

/** The short form on a Person summary: the closest path's term, its marks, line and degree, and how many other paths. */
export const KinshipShort = z
  .object({
    kind: KinshipKind,
    term: KinshipTerm,
    possible: z.boolean(),
    line: KinshipLine,
    degree: z.number().int().min(1).nullable(),
    others: z.number().int().min(0).describe('How many other paths were found'),
    more: z.boolean().describe('A limit cut the search: there may be more paths'),
  })
  .meta({ id: 'KinshipShort', description: "The Person's closest kinship to the signed-in Member's own Person" });

export const KinshipQuery = z
  .object({ from: Id.optional().describe("The starting Person; by default the caller's own Person. An Agent must name one") })
  .meta({ id: 'KinshipQuery' });

export type KinshipShort = z.infer<typeof KinshipShort>;
