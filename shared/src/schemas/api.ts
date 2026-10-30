/**
 * Payloads of the read API (tree-read-api spec). The server validates requests and
 * serialises responses with these, and the OpenAPI description is generated from them.
 */
import { z } from 'zod';
import { EdtfDate, GeoPoint, Id, IsoDay, Period, Version } from './common.js';
import {
  ChildLinkType,
  CitationRecord,
  Confidence,
  EstateRecord,
  EventType,
  FamilyAccount,
  HouseNumberRecord,
  ImageKind,
  ImageMetadata,
  MunicipalityLink,
  NameRecord,
  ParishRecord,
  PlaceNameRecord,
  PlaceType,
  RoleType,
  Sex,
  SourceType,
} from './tree.js';

// ---------------------------------------------------------------- shared pieces

export const PersonSummary = z
  .object({
    id: Id,
    version: Version,
    sex: Sex,
    given: z.string(),
    surname: z.string(),
    displayName: z.string().describe('Primary Name as one string'),
    living: z.boolean().describe('Computed from Events by the Living rule'),
    birth: z.string().nullable().describe('EDTF date of the earliest birth or baptism Event'),
    death: z.string().nullable().describe('EDTF date of the earliest death or burial Event'),
  })
  .meta({ id: 'PersonSummary' });

export const PlaceRef = z
  .object({ id: Id, version: Version, name: z.string(), location: GeoPoint.nullable() })
  .meta({ id: 'PlaceRef' });

export const HouseRef = z
  .object({
    id: Id,
    version: Version,
    placeId: Id,
    number: z.string().nullable().describe('House number (čp.) the House had at the time in question, when known'),
    location: GeoPoint.nullable(),
  })
  .meta({ id: 'HouseRef' });

export const ParishRef = z.object({ id: Id, version: Version, name: z.string() }).meta({ id: 'ParishRef' });
export const EstateRef = z.object({ id: Id, version: Version, name: z.string() }).meta({ id: 'EstateRef' });

export const EventSummary = z
  .object({
    id: Id,
    version: Version,
    type: EventType,
    typeDetail: z.string().nullable(),
    date: z.string().nullable(),
    earliest: IsoDay.nullable(),
    latest: IsoDay.nullable(),
    place: PlaceRef.nullable().describe('The Event Place, or the Place of its House'),
    house: HouseRef.nullable(),
    description: z.string().nullable(),
  })
  .meta({ id: 'EventSummary' });

export const CitationSummary = z
  .object({
    id: Id,
    version: Version,
    sourceId: Id,
    sourceTitle: z.string(),
    page: z.string().nullable(),
    confidence: Confidence,
  })
  .meta({ id: 'CitationSummary' });

export const NameView = NameRecord.safeExtend({ citations: z.array(CitationSummary) }).meta({ id: 'NameView' });

// ---------------------------------------------------------------- Persons

export const PersonSearchQuery = z.object({
  q: z.string().trim().min(1).max(200).optional().describe('Any part of any Name; case and diacritics are ignored'),
  placeId: Id.optional().describe('Only Persons with an Event at this Place or one of its Houses'),
  from: z.coerce.number().int().min(1).max(9999).optional().describe('Only Persons with an Event that could be in or after this year'),
  to: z.coerce.number().int().min(1).max(9999).optional().describe('Only Persons with an Event that could be in or before this year'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const PersonSearchHit = z
  .object({
    person: PersonSummary,
    matchedName: z.string().nullable().describe('The Name that matched the query, as found'),
  })
  .meta({ id: 'PersonSearchHit' });

export const PersonSearchResult = z
  .object({ items: z.array(PersonSearchHit), limit: z.number().int(), offset: z.number().int() })
  .meta({ id: 'PersonSearchResult' });

export const PersonEventView = z
  .object({ roleId: Id, role: RoleType, roleDetail: z.string().nullable(), event: EventSummary })
  .meta({ id: 'PersonEventView' });

export const PartnerFamilyView = z
  .object({
    id: Id,
    version: Version,
    partner: PersonSummary.nullable().describe('The other partner, when known'),
    children: z.array(z.object({ linkId: Id, linkType: ChildLinkType, person: PersonSummary })),
  })
  .meta({ id: 'PartnerFamilyView' });

export const ChildFamilyView = z
  .object({
    id: Id,
    version: Version,
    linkId: Id,
    linkType: ChildLinkType,
    partners: z.array(PersonSummary),
  })
  .meta({ id: 'ChildFamilyView' });

export const PersonDetail = z
  .object({
    id: Id,
    version: Version,
    sex: Sex,
    living: z.boolean(),
    names: z.array(NameView),
    events: z.array(PersonEventView).describe('Ordered by the earliest date each could be'),
    familiesAsPartner: z.array(PartnerFamilyView),
    familiesAsChild: z.array(ChildFamilyView),
    portraits: z.array(z.lazy(() => ImageView)),
  })
  .meta({ id: 'PersonDetail' });

// ---------------------------------------------------------------- Pedigree

export const PedigreeQuery = z.object({
  generations: z.coerce.number().int().min(1).max(12).default(6).describe('Generations in the chart, counting the root Person as the first'),
});

export const Pedigree = z
  .object({
    rootId: Id,
    direction: z.enum(['ancestors', 'descendants']),
    generations: z.number().int(),
    persons: z.array(
      z.object({
        generation: z.number().int().describe('1 is the root Person, 2 its parents (or children), and so on'),
        relation: z.enum(['root', 'ancestor', 'descendant', 'partner']).describe('"partner": the other partner in a descendant\'s Family'),
        person: PersonSummary,
      }),
    ),
    families: z.array(z.object({ id: Id, version: Version, partner1Id: Id.nullable(), partner2Id: Id.nullable() })),
    childLinks: z.array(z.object({ id: Id, familyId: Id, childId: Id, linkType: ChildLinkType })),
  })
  .meta({ id: 'Pedigree' });

// ---------------------------------------------------------------- Families

export const FamilyDetail = z
  .object({
    id: Id,
    version: Version,
    partners: z.array(z.object({ position: z.union([z.literal(1), z.literal(2)]), person: PersonSummary })),
    children: z.array(z.object({ linkId: Id, linkVersion: Version, linkType: ChildLinkType, person: PersonSummary })),
    events: z.array(EventSummary).describe('Events in which the partners take part as partners, such as the marriage'),
  })
  .meta({ id: 'FamilyDetail' });

// ---------------------------------------------------------------- Events

export const EventDetail = EventSummary.safeExtend({
  roles: z.array(z.object({ id: Id, version: Version, role: RoleType, roleDetail: z.string().nullable(), person: PersonSummary })),
  citations: z.array(CitationSummary),
  parishes: z.array(ParishRef).describe('Parishes the Place belonged to at the date of the Event'),
  estates: z.array(EstateRef).describe('Estates the Place was part of at the date of the Event'),
}).meta({ id: 'EventDetail' });

// ---------------------------------------------------------------- Map

export const MapEventsQuery = z.object({
  bbox: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, 'bbox is minLon,minLat,maxLon,maxLat')
    .describe('Map area as minLon,minLat,maxLon,maxLat (WGS 84)'),
  from: z.coerce.number().int().min(1).max(9999).describe('First year of the range'),
  to: z.coerce.number().int().min(1).max(9999).describe('Last year of the range (inclusive)'),
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
});

export const MapEvent = z
  .object({
    id: Id,
    version: Version,
    type: EventType,
    date: z.string().nullable(),
    earliest: IsoDay.nullable(),
    latest: IsoDay.nullable(),
    location: GeoPoint.describe('Location of the House, else of the Place'),
    place: PlaceRef.nullable(),
    house: HouseRef.nullable(),
    persons: z.array(z.object({ id: Id, displayName: z.string(), role: RoleType })),
  })
  .meta({ id: 'MapEvent' });

export const MapEventsResult = z
  .object({
    events: z.array(MapEvent),
    truncated: z.boolean().describe('True when more Events matched than the limit'),
  })
  .meta({ id: 'MapEventsResult' });

// ---------------------------------------------------------------- Places, Houses, Parishes, Estates

export const PlaceSearchQuery = z.object({
  q: z.string().trim().min(1).max(200).optional().describe('Any part of any name of the Place; case and diacritics are ignored'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
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
}).meta({ id: 'PlaceDetail' });

export const HouseLookupQuery = z.object({
  number: z.string().regex(/^\d{1,5}[a-z]?$/).describe('House number (čp.)'),
  at: EdtfDate.describe('Date at which the number was carried'),
});

export const HouseDetail = HouseSummary.safeExtend({
  place: PlaceRef,
  events: z.array(EventSummary).describe('Events at this House, ordered by earliest date'),
}).meta({ id: 'HouseDetail' });

export const ParishDetail = ParishRecord.safeExtend({
  places: z.array(z.object({ linkId: Id, period: Period, place: PlaceRef })),
}).meta({ id: 'ParishDetail' });

export const EstateDetail = EstateRecord.safeExtend({
  places: z.array(z.object({ linkId: Id, period: Period, place: PlaceRef })),
}).meta({ id: 'EstateDetail' });

// ---------------------------------------------------------------- Sources, Citations, images

export const SourceSearchQuery = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  type: SourceType.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const SourceSummary = z
  .object({
    id: Id,
    version: Version,
    type: SourceType,
    title: z.string(),
    repository: z.string().nullable(),
    reference: z.string().nullable(),
    url: z.string().nullable(),
    familyAccount: FamilyAccount.nullable(),
  })
  .meta({ id: 'SourceSummary' });

export const SourceSearchResult = z
  .object({ items: z.array(SourceSummary), limit: z.number().int(), offset: z.number().int() })
  .meta({ id: 'SourceSearchResult' });

export const SourceDetail = SourceSummary.safeExtend({
  citations: z.array(CitationSummary),
}).meta({ id: 'SourceDetail' });

export const ImageView = ImageMetadata.safeExtend({
  url: z.url().describe('Presigned link to the image; expires within minutes'),
  urlExpiresAt: z.iso.datetime(),
}).meta({ id: 'ImageView' });

export const CitationDetail = CitationRecord.safeExtend({
  source: SourceSummary,
  events: z.array(EventSummary),
  names: z.array(z.object({ id: Id, personId: Id, asFound: z.string() })),
  images: z.array(ImageView),
}).meta({ id: 'CitationDetail' });

export const ImageQuery = z.object({ kind: ImageKind.optional() });

export const ImageLinkQuery = z.object({ full: z.enum(['true', 'false']).optional().describe('true: the original file instead of the display copy') });

export const IdParams = z.object({ id: Id });

export const Health = z
  .object({ status: z.enum(['ok', 'degraded']), database: z.enum(['ok', 'unreachable']), release: z.string() })
  .meta({ id: 'Health' });

export type PersonSummary = z.infer<typeof PersonSummary>;
export type PlaceRef = z.infer<typeof PlaceRef>;
export type HouseRef = z.infer<typeof HouseRef>;
export type EventSummary = z.infer<typeof EventSummary>;
export type CitationSummary = z.infer<typeof CitationSummary>;
export type PersonDetail = z.infer<typeof PersonDetail>;
export type PersonSearchQuery = z.infer<typeof PersonSearchQuery>;
export type PersonSearchResult = z.infer<typeof PersonSearchResult>;
export type Pedigree = z.infer<typeof Pedigree>;
export type FamilyDetail = z.infer<typeof FamilyDetail>;
export type EventDetail = z.infer<typeof EventDetail>;
export type MapEventsQuery = z.infer<typeof MapEventsQuery>;
export type MapEvent = z.infer<typeof MapEvent>;
export type MapEventsResult = z.infer<typeof MapEventsResult>;
export type PlaceSummary = z.infer<typeof PlaceSummary>;
export type PlaceDetail = z.infer<typeof PlaceDetail>;
export type HouseSummary = z.infer<typeof HouseSummary>;
export type HouseDetail = z.infer<typeof HouseDetail>;
export type ParishDetail = z.infer<typeof ParishDetail>;
export type EstateDetail = z.infer<typeof EstateDetail>;
export type SourceSummary = z.infer<typeof SourceSummary>;
export type SourceDetail = z.infer<typeof SourceDetail>;
export type CitationDetail = z.infer<typeof CitationDetail>;
export type ImageView = z.infer<typeof ImageView>;
export type Health = z.infer<typeof Health>;
export type PlaceSearchResult = z.infer<typeof PlaceSearchResult>;
export type SourceSearchResult = z.infer<typeof SourceSearchResult>;
