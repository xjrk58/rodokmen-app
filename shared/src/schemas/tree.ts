/**
 * Records of the Tree (tree-model spec). One schema per stored record: these are what
 * the database holds and what typed Proposal operations will later create and change.
 * Every record has an `id` (UUIDv7) and a `version`.
 */
import { z } from 'zod';
import { EdtfDate, GeoPoint, Id, IsoDay, NameLanguage, Period, Version, WebUrl } from './common.js';

const text = (max: number) => z.string().max(max);
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

// ---------------------------------------------------------------- Persons and Names

export const Sex = z.enum(['female', 'male', 'unknown']).meta({ id: 'Sex' });

export const NameType = z
  .enum(['birth', 'married', 'latin', 'german', 'nickname', 'other'])
  .meta({ id: 'NameType', description: 'Birth name, married name, Latin form, German form, nickname or other' });

export const NameRecord = z
  .object({
    id: Id,
    version: Version,
    personId: Id,
    given: text(200).describe('Given names; empty when unknown'),
    surname: text(200).describe('Surname; empty when unknown'),
    type: NameType,
    asFound: nonEmpty(400).describe('The spelling exactly as found in the Source'),
    primary: z.boolean().describe('Exactly one Name of each Person is primary'),
  })
  .refine((n) => n.given.trim() !== '' || n.surname.trim() !== '', { message: 'a Name needs a given name or a surname', path: ['given'] })
  .meta({ id: 'NameRecord' });

export const PersonRecord = z
  .object({
    id: Id,
    version: Version,
    sex: Sex,
  })
  .meta({ id: 'PersonRecord' });

/** Checks the Names of one Person: at least one, exactly one primary, all for this Person. */
export function checkPersonNames(personId: string, names: ReadonlyArray<{ personId: string; primary: boolean }>): string[] {
  const problems: string[] = [];
  if (names.length === 0) problems.push('a Person needs at least one Name');
  const primaries = names.filter((n) => n.primary).length;
  if (names.length > 0 && primaries !== 1) problems.push(`a Person has exactly one primary Name, found ${primaries}`);
  if (names.some((n) => n.personId !== personId)) problems.push('every Name must belong to the Person');
  return problems;
}

/** A Person with its Names, validated together. */
export const PersonWithNames = z
  .object({ person: PersonRecord, names: z.array(NameRecord) })
  .superRefine((value, ctx) => {
    for (const message of checkPersonNames(value.person.id, value.names)) ctx.addIssue({ code: 'custom', message, path: ['names'] });
  })
  .meta({ id: 'PersonWithNames' });

// ---------------------------------------------------------------- Families

export const ChildLinkType = z.enum(['birth', 'adoptive', 'foster', 'step']).meta({ id: 'ChildLinkType', description: 'How a child belongs to a Family' });

export const FamilyRecord = z
  .object({
    id: Id,
    version: Version,
    partner1Id: Id.nullable(),
    partner2Id: Id.nullable(),
  })
  .refine((f) => f.partner1Id === null || f.partner1Id !== f.partner2Id, { message: 'the two partners must be different Persons', path: ['partner2Id'] })
  .meta({ id: 'FamilyRecord', description: 'At most two partners; children are ChildLinks' });

export const ChildLinkRecord = z
  .object({
    id: Id,
    version: Version,
    familyId: Id,
    childId: Id,
    linkType: ChildLinkType,
  })
  .meta({ id: 'ChildLinkRecord' });

// ---------------------------------------------------------------- Events and Roles

export const EventType = z.enum(['birth', 'baptism', 'marriage', 'death', 'burial', 'residence', 'census', 'other']).meta({ id: 'EventType' });

export const EventRecord = z
  .object({
    id: Id,
    version: Version,
    type: EventType,
    typeDetail: text(200).nullable().describe('What kind of Event, when the type is "other"'),
    date: EdtfDate.nullable(),
    placeId: Id.nullable(),
    houseId: Id.nullable().describe('A House implies its Place; give either a Place or a House'),
    description: text(4000).nullable(),
  })
  .refine((e) => e.placeId === null || e.houseId === null, { message: 'give either a Place or a House, not both', path: ['houseId'] })
  .refine((e) => e.type !== 'other' || (e.typeDetail !== null && e.typeDetail.trim() !== ''), {
    message: 'an Event of type "other" needs a typeDetail',
    path: ['typeDetail'],
  })
  .meta({ id: 'EventRecord' });

export const RoleType = z
  .enum(['child', 'father', 'mother', 'partner', 'godparent', 'witness', 'priest', 'deceased', 'informant', 'other'])
  .meta({ id: 'RoleType', description: 'The part a Person plays in an Event' });

export const RoleRecord = z
  .object({
    id: Id,
    version: Version,
    eventId: Id,
    personId: Id,
    role: RoleType,
    roleDetail: text(200).nullable(),
  })
  .meta({ id: 'RoleRecord' });

// ---------------------------------------------------------------- Places, Houses, Parishes, Estates

export const PlaceType = z.enum(['village', 'town', 'hamlet', 'other']).meta({ id: 'PlaceType' });

/** Link to today's Municipality (obec), by the RÚIAN municipality code the app's municipality list uses. */
export const MunicipalityLink = z
  .object({
    code: z.string().regex(/^\d{6}$/, 'a RÚIAN municipality code has 6 digits'),
    name: nonEmpty(200),
  })
  .meta({ id: 'MunicipalityLink' });

export const PlaceRecord = z
  .object({
    id: Id,
    version: Version,
    type: PlaceType,
    location: GeoPoint.nullable(),
    municipality: MunicipalityLink.nullable(),
  })
  .meta({ id: 'PlaceRecord' });

export const PlaceNameRecord = z
  .object({
    id: Id,
    version: Version,
    placeId: Id,
    name: nonEmpty(200),
    language: NameLanguage,
    primary: z.boolean(),
    period: Period,
  })
  .meta({ id: 'PlaceNameRecord' });

export const HouseRecord = z
  .object({
    id: Id,
    version: Version,
    placeId: Id,
    location: GeoPoint.nullable(),
    note: text(4000).nullable(),
  })
  .meta({ id: 'HouseRecord' });

export const HouseNumberRecord = z
  .object({
    id: Id,
    version: Version,
    houseId: Id,
    number: z.string().regex(/^\d{1,5}[a-z]?$/, 'a house number (čp.) is digits, optionally followed by one letter'),
    period: Period,
  })
  .meta({ id: 'HouseNumberRecord', description: 'A house number (čp.) the House carried during a period' });

export const ParishRecord = z
  .object({
    id: Id,
    version: Version,
    name: nonEmpty(200),
    seatPlaceId: Id.nullable().describe('The Place where the parish church stands'),
  })
  .meta({ id: 'ParishRecord' });

export const PlaceParishRecord = z.object({ id: Id, version: Version, placeId: Id, parishId: Id, period: Period }).meta({ id: 'PlaceParishRecord' });

export const EstateRecord = z
  .object({ id: Id, version: Version, name: nonEmpty(200) })
  .meta({ id: 'EstateRecord', description: 'A manorial domain (panství)' });

export const PlaceEstateRecord = z.object({ id: Id, version: Version, placeId: Id, estateId: Id, period: Period }).meta({ id: 'PlaceEstateRecord' });

// ---------------------------------------------------------------- Sources and Citations

export const SourceType = z.enum(['parish_register', 'census', 'land_book', 'family_account', 'other']).meta({ id: 'SourceType' });

export const FamilyAccount = z
  .object({
    givenBy: nonEmpty(200).describe('Who gave the account'),
    givenByPersonId: Id.nullable().describe('The Person who gave it, when they are in the Tree'),
    givenOn: EdtfDate.describe('When the account was given'),
  })
  .meta({ id: 'FamilyAccount' });

export const RegisterKind = z
  .enum(['birth', 'marriage', 'death'])
  .meta({ id: 'RegisterKind', description: 'Births (and baptisms), marriages or deaths (and burials): the N, O and Z of a matrika' });

/** A year as a register or a search covers it. */
export const Year = z.number().int().min(1).max(9999);

/**
 * What a register book covers (research-leads spec, "Gap finder suggests leads"): the Parish whose
 * register it is, its kinds of entries, and its years (open where unknown). The gap finder names
 * a register whose Parish, kind and years fit a gap.
 */
export const RegisterCoverage = z
  .object({
    parishId: Id.describe('The Parish that kept the register'),
    kinds: z.array(RegisterKind).min(1).max(3).describe('Which entries it holds'),
    from: Year.nullable().describe('First year it covers; null when unknown'),
    to: Year.nullable().describe('Last year it covers; null when unknown'),
  })
  .refine((r) => r.from === null || r.to === null || r.from <= r.to, { message: 'the years end before they start', path: ['to'] })
  .refine((r) => new Set(r.kinds).size === r.kinds.length, { message: 'name each kind once', path: ['kinds'] })
  .meta({ id: 'RegisterCoverage' });

export const SourceRecord = z
  .object({
    id: Id,
    version: Version,
    type: SourceType,
    title: nonEmpty(400),
    repository: text(400).nullable().describe('Archive or holder'),
    reference: text(200).nullable().describe('Call number or signature (signatura)'),
    url: WebUrl.nullable(),
    familyAccount: FamilyAccount.nullable(),
    register: RegisterCoverage.nullable().default(null).describe('For a register book: its Parish, kinds and years'),
  })
  .refine((s) => (s.type === 'family_account') === (s.familyAccount !== null), {
    message: 'a Family account Source records who gave the account and when; other Sources do not',
    path: ['familyAccount'],
  })
  .refine((s) => s.register === null || s.type === 'parish_register', { message: 'only a parish register covers a Parish', path: ['register'] })
  .meta({ id: 'SourceRecord' });

export const Confidence = z
  .enum(['very_low', 'low', 'normal', 'high', 'very_high'])
  .meta({ id: 'Confidence', description: 'Confidence in the Citation, from very low to very high' });

export const CitationRecord = z
  .object({
    id: Id,
    version: Version,
    sourceId: Id,
    page: text(200).nullable().describe('Page or frame; null for a Family account'),
    transcription: nonEmpty(20_000).describe('Transcription in the original language'),
    readOn: IsoDay.describe('When the entry was read'),
    confidence: Confidence,
    note: text(4000).nullable(),
  })
  .meta({ id: 'CitationRecord' });

// ---------------------------------------------------------------- Images

export const ImageKind = z
  .enum(['page', 'photo', 'portrait'])
  .meta({ id: 'ImageKind', description: 'Register page image, own photo (letter, gravestone) or portrait' });

export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];
export const IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export const ImageMetadata = z
  .object({
    id: Id,
    version: Version,
    kind: ImageKind,
    citationId: Id.nullable(),
    personIds: z.array(Id).describe('Persons shown, for portraits'),
    contentType: z.enum(IMAGE_CONTENT_TYPES),
    byteSize: z.number().int().positive().max(IMAGE_MAX_BYTES),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    caption: text(1000).nullable(),
  })
  .refine((i) => i.kind === 'portrait' || i.citationId !== null, { message: 'page images and photos belong to a Citation', path: ['citationId'] })
  .refine((i) => i.kind !== 'portrait' || i.personIds.length > 0, { message: 'a portrait shows at least one Person', path: ['personIds'] })
  .meta({ id: 'ImageMetadata' });

export type Sex = z.infer<typeof Sex>;
export type NameType = z.infer<typeof NameType>;
export type NameRecord = z.infer<typeof NameRecord>;
export type PersonRecord = z.infer<typeof PersonRecord>;
export type ChildLinkType = z.infer<typeof ChildLinkType>;
export type FamilyRecord = z.infer<typeof FamilyRecord>;
export type ChildLinkRecord = z.infer<typeof ChildLinkRecord>;
export type EventType = z.infer<typeof EventType>;
export type EventRecord = z.infer<typeof EventRecord>;
export type RoleType = z.infer<typeof RoleType>;
export type RoleRecord = z.infer<typeof RoleRecord>;
export type PlaceType = z.infer<typeof PlaceType>;
export type MunicipalityLink = z.infer<typeof MunicipalityLink>;
export type PlaceRecord = z.infer<typeof PlaceRecord>;
export type PlaceNameRecord = z.infer<typeof PlaceNameRecord>;
export type HouseRecord = z.infer<typeof HouseRecord>;
export type HouseNumberRecord = z.infer<typeof HouseNumberRecord>;
export type ParishRecord = z.infer<typeof ParishRecord>;
export type PlaceParishRecord = z.infer<typeof PlaceParishRecord>;
export type EstateRecord = z.infer<typeof EstateRecord>;
export type PlaceEstateRecord = z.infer<typeof PlaceEstateRecord>;
export type SourceType = z.infer<typeof SourceType>;
export type FamilyAccount = z.infer<typeof FamilyAccount>;
export type SourceRecord = z.infer<typeof SourceRecord>;
export type RegisterKind = z.infer<typeof RegisterKind>;
export type RegisterCoverage = z.infer<typeof RegisterCoverage>;
export type Confidence = z.infer<typeof Confidence>;
export type CitationRecord = z.infer<typeof CitationRecord>;
export type ImageKind = z.infer<typeof ImageKind>;
export type ImageMetadata = z.infer<typeof ImageMetadata>;
