/**
 * Erasure (erasure spec): what erasing a Living person removes, shown to the Owner before they
 * confirm, and the confirmation that names the Person.
 */
import { z } from 'zod';
import { EventSummary, PersonSummary } from './api.js';
import { Id } from './common.js';

export const ErasurePreview = z
  .object({
    person: PersonSummary,
    mayErase: z.boolean().describe('Whether the Person is Living, the only kind of Person that can be erased'),
    confirmWith: z.string().describe('The name to type to confirm: the given name and surname of the primary Name'),
    names: z.number().int().describe('Names that go'),
    roles: z.number().int().describe('Roles in Events that go'),
    familyLinks: z.number().int().describe('Links to Families as a partner or child that go'),
    labels: z.number().int(),
    events: z.array(EventSummary).describe('Events only this Person took part in, which disappear with them'),
    citations: z.number().int().describe('Citations attached only to what goes, which disappear too'),
    images: z.number().int().describe('Images that show only this Person, or belong to a Citation that goes'),
    families: z.number().int().describe('Families left with nobody, which disappear'),
    leads: z.object({ deleted: z.number().int(), unlinked: z.number().int() }).describe('Research leads deleted (about only this Person) and unlinked'),
    history: z.number().int().describe('Proposals whose history entries become "erased record"'),
    pending: z.number().int().describe('Pending Proposals about this Person, which are closed'),
  })
  .meta({ id: 'ErasurePreview' });

export const EraseBody = z
  .object({ confirmation: z.string().max(400).describe("The Person's name as shown in confirmWith; case and spacing do not matter") })
  .meta({ id: 'EraseBody' });

export const ErasureResult = z
  .object({
    personId: Id,
    erasedAt: z.iso.datetime(),
    events: z.number().int(),
    citations: z.number().int(),
    images: z.number().int(),
    history: z.number().int(),
  })
  .meta({ id: 'ErasureResult' });

export type ErasurePreview = z.infer<typeof ErasurePreview>;
export type EraseBody = z.infer<typeof EraseBody>;
export type ErasureResult = z.infer<typeof ErasureResult>;
