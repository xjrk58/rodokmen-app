/**
 * Payloads of the read API for Places, Houses, Parishes and Estates (tree-read-api spec).
 */
import { z } from 'zod';
import { EstateRef, EventSummary, NotesField, ParishRef, PersonSummary, PlaceRef } from './api.js';
import { EdtfDate, GeoPoint, Id, Paging, Period, Version } from './common.js';
import { EstateRecord, HouseNumberRecord, MunicipalityLink, ParishRecord, PlaceNameRecord, PlaceType, RoleType } from './tree.js';

export const PlaceEventsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(2000).default(1000),
});

export const PlaceEvent = EventSummary.safeExtend({
  persons: z.array(z.object({ role: RoleType, roleDetail: z.string().nullable(), person: PersonSummary })),
}).meta({ id: 'PlaceEvent' });

export const PlaceEvents = z
  .object({
    place: PlaceRef,
    events: z.array(PlaceEvent).describe('Events at the Place and at its Houses, ordered by the earliest date each could be; undated last'),
    truncated: z.boolean().describe('True when more Events matched than the limit'),
  })
  .meta({ id: 'PlaceEvents' });

export const PlaceSearchQuery = z.object({
  q: z.string().trim().min(1).max(200).optional().describe('Any part of any name of the Place; case and diacritics are ignored'),
  ...Paging.shape,
});

export const PlaceSummary = z
  .object({
    id: Id,
    version: Version,
    type: PlaceType,
    name: z.string(),
    location: GeoPoint.nullable(),
    municipality: MunicipalityLink.nullable(),
  })
  .meta({ id: 'PlaceSummary' });

export const PlaceSearchResult = z
  .object({ items: z.array(PlaceSummary), limit: z.number().int(), offset: z.number().int() })
  .meta({ id: 'PlaceSearchResult' });

export const HouseSummary = z
  .object({
    id: Id,
    version: Version,
    placeId: Id,
    location: GeoPoint.nullable(),
    note: z.string().nullable(),
    numbers: z.array(HouseNumberRecord).describe('House numbers (čp.) over time, oldest first'),
  })
  .meta({ id: 'HouseSummary' });

export const PlaceDetail = PlaceSummary.safeExtend({
  names: z.array(PlaceNameRecord),
  parishes: z.array(z.object({ linkId: Id, linkVersion: Version, period: Period, parish: ParishRef })),
  estates: z.array(z.object({ linkId: Id, linkVersion: Version, period: Period, estate: EstateRef })),
  houses: z.array(HouseSummary),
  notes: NotesField,
}).meta({ id: 'PlaceDetail' });

export const HouseLookupQuery = z.object({
  number: z
    .string()
    .regex(/^\d{1,5}[a-z]?$/)
    .describe('House number (čp.)'),
  at: EdtfDate.describe('Date at which the number was carried'),
});

export const HouseDetail = HouseSummary.safeExtend({
  place: PlaceRef,
  events: z.array(EventSummary).describe('Events at this House, ordered by earliest date'),
  notes: NotesField,
}).meta({ id: 'HouseDetail' });

export const ParishDetail = ParishRecord.safeExtend({
  places: z.array(z.object({ linkId: Id, period: Period, place: PlaceRef })),
  notes: NotesField,
}).meta({ id: 'ParishDetail' });

export const EstateDetail = EstateRecord.safeExtend({
  places: z.array(z.object({ linkId: Id, period: Period, place: PlaceRef })),
  notes: NotesField,
}).meta({ id: 'EstateDetail' });

export type PlaceEvent = z.infer<typeof PlaceEvent>;
export type PlaceEvents = z.infer<typeof PlaceEvents>;
export type PlaceSummary = z.infer<typeof PlaceSummary>;
export type PlaceDetail = z.infer<typeof PlaceDetail>;
export type HouseSummary = z.infer<typeof HouseSummary>;
export type HouseDetail = z.infer<typeof HouseDetail>;
export type ParishDetail = z.infer<typeof ParishDetail>;
export type EstateDetail = z.infer<typeof EstateDetail>;
export type PlaceSearchResult = z.infer<typeof PlaceSearchResult>;
