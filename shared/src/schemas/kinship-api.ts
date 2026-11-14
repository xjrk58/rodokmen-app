/**
 * The answer of GET /api/persons/{id}/kinship (kinship spec, "Kinship as data"), with the Persons
 * its paths name. Apart from kinship.ts, which PersonSummary itself uses for its short form.
 */
import { z } from 'zod';
import { PersonSummary } from './api.js';
import { Id } from './common.js';
import { KinshipConnection, KinshipPath } from './kinship.js';

export const Kinship = z
  .object({
    from: Id.describe('The starting Person: the caller’s own Person, or the one named'),
    to: Id,
    asOf: z
      .object({
        logEntryId: Id.nullable().describe('The newest accepted change of the Tree the answer comes from; null before the first'),
        at: z.iso.datetime().nullable(),
      })
      .describe('The state of the Tree the answer was computed from'),
    paths: z.array(KinshipPath).max(100).describe('Every path, the closest first, in the fixed order; at most 100'),
    more: z.boolean().describe('A limit cut the search: there may be more paths'),
    connection: KinshipConnection.nullable().describe('With no path, the shortest chain of Family links; null with a path or with no chain at all'),
    persons: z.array(PersonSummary).describe('Every Person the paths and the connection name, as the tree shows them'),
  })
  .meta({ id: 'Kinship', description: 'How one Person is related to another, worked out from the Family links by fixed rules' });

export type Kinship = z.infer<typeof Kinship>;
