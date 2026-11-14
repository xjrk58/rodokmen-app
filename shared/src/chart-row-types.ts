/**
 * The rows the server gathers for a Chart (server/src/charts/gather.ts), as the shell of
 * shared/src/chart-rows.ts and shared/src/sheet-reduction.ts reads them. Types only.
 */
import type { Relation } from './relation.js';

export interface RowName {
  readonly id: string;
  readonly given: string;
  readonly surname: string;
  readonly type: string;
  readonly primary: boolean;
  readonly order: number;
}

/** A Person: on a card, or only with a Role in an Event of one (then `names` may be empty). */
export interface RowPerson {
  readonly id: string;
  readonly sex: 'female' | 'male' | 'unknown';
  readonly relation: Relation;
  readonly familyRoot: boolean;
  /** By the Living rule on the Chart's `livingOn` day. */
  readonly living: boolean;
  readonly names: readonly RowName[];
}

export interface RowFamily {
  readonly id: string;
  readonly partner1Id: string | null;
  readonly partner2Id: string | null;
  readonly weakLink: boolean;
}

export interface RowChildLink {
  readonly id: string;
  readonly familyId: string;
  readonly childId: string;
  readonly linkType: 'birth' | 'adoptive' | 'foster' | 'step';
  /** The order the Family records its children in. */
  readonly order: number;
  readonly weakLink: boolean;
}

export interface RowRole {
  readonly personId: string;
  readonly role: string;
}

/** An Event, its Place (a House's Place for a House) and the house number the House had at its date. */
export interface RowEvent {
  readonly id: string;
  readonly type: string;
  readonly date: string | null;
  readonly placeId: string | null;
  readonly place: string | null;
  readonly houseId: string | null;
  readonly houseNumber: string | null;
  readonly roles: readonly RowRole[];
  readonly sourceIds: readonly string[];
}

export interface RowSource {
  readonly id: string;
  readonly title: string;
}

/** Everything a Chart is made from. */
export interface ChartRows {
  /** The day the Living rule was applied, an ISO day. */
  readonly livingOn: string;
  readonly asOf: { readonly logEntryId: string | null; readonly acceptedAt: string | null };
  readonly persons: readonly RowPerson[];
  readonly families: readonly RowFamily[];
  readonly childLinks: readonly RowChildLink[];
  readonly events: readonly RowEvent[];
  readonly sources: readonly RowSource[];
}
