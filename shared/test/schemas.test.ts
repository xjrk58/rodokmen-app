import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ChildLinkRecord,
  CitationRecord,
  EstateRecord,
  EventRecord,
  FamilyRecord,
  HouseNumberRecord,
  HouseRecord,
  ImageMetadata,
  MunicipalityLink,
  NameRecord,
  ParishRecord,
  PersonRecord,
  PersonWithNames,
  PlaceEstateRecord,
  PlaceNameRecord,
  PlaceParishRecord,
  PlaceRecord,
  RoleRecord,
  SourceRecord,
  Period,
} from '../src/index.js';

let n = 0;
/** Deterministic UUIDv7-shaped ids for the examples. */
const id = () => `0192f0c4-7a1e-7c3b-9d2a-${String(++n).padStart(12, '0')}`;

const personId = id();
const otherId = id();
const familyId = id();
const placeId = id();
const houseId = id();
const sourceId = id();
const citationId = id();

const ok = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  expect(result.error?.issues ?? []).toEqual([]);
};
const bad = (schema: z.ZodType, value: unknown, message?: RegExp) => {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  if (message) expect(result.error!.issues.map((i) => i.message).join('; ')).toMatch(message);
};

const name = (over: Record<string, unknown> = {}) => ({
  id: id(),
  version: 1,
  personId,
  given: 'Jan',
  surname: 'Novák',
  type: 'birth',
  asFound: 'Jan Novák',
  primary: true,
  ...over,
});

describe('Person and Name', () => {
  it('accepts a Person with a primary Name and its Latin and German forms', () => {
    ok(PersonRecord, { id: personId, version: 1, sex: 'male' });
    ok(PersonWithNames, {
      person: { id: personId, version: 3, sex: 'male' },
      names: [
        name(),
        name({ type: 'latin', given: 'Joannes', surname: 'Nowak', asFound: 'Joannes Nowak', primary: false }),
        name({ type: 'german', given: 'Johann', surname: 'Nowak', asFound: 'Johann Nowak', primary: false }),
      ],
    });
  });

  it('refuses a Person without Names, with two primary Names, or with unknown sex', () => {
    bad(PersonWithNames, { person: { id: personId, version: 1, sex: 'male' }, names: [] }, /at least one Name/);
    bad(PersonWithNames, { person: { id: personId, version: 1, sex: 'male' }, names: [name(), name({ type: 'german' })] }, /exactly one primary Name, found 2/);
    bad(PersonWithNames, { person: { id: personId, version: 1, sex: 'male' }, names: [name({ primary: false })] }, /found 0/);
    bad(PersonRecord, { id: personId, version: 1, sex: 'm' });
  });

  it('refuses a Name without spelling as found, without any name, or of an unknown type', () => {
    bad(NameRecord, name({ asFound: '' }));
    bad(NameRecord, name({ given: '', surname: ' ' }), /given name or a surname/);
    bad(NameRecord, name({ type: 'alias' }));
    ok(NameRecord, name({ given: '', surname: 'Novák', type: 'nickname', asFound: 'Novákova' }));
  });

  it('refuses a missing or non-positive version and a malformed id', () => {
    bad(PersonRecord, { id: personId, sex: 'male' });
    bad(PersonRecord, { id: personId, version: 0, sex: 'male' });
    bad(PersonRecord, { id: 'jan-novak-1801', version: 1, sex: 'male' });
  });
});

describe('Family and child links', () => {
  it('accepts up to two partners, and a single known partner', () => {
    ok(FamilyRecord, { id: familyId, version: 1, partner1Id: personId, partner2Id: otherId });
    ok(FamilyRecord, { id: familyId, version: 1, partner1Id: null, partner2Id: otherId });
  });

  it('refuses the same Person as both partners', () => {
    bad(FamilyRecord, { id: familyId, version: 1, partner1Id: personId, partner2Id: personId }, /different Persons/);
  });

  it.each(['birth', 'adoptive', 'foster', 'step'])('accepts a %s child link', (linkType) => {
    ok(ChildLinkRecord, { id: id(), version: 1, familyId, childId: personId, linkType });
  });

  it('refuses an unknown child link type', () => {
    bad(ChildLinkRecord, { id: id(), version: 1, familyId, childId: personId, linkType: 'natural' });
  });
});

describe('Event and Role', () => {
  const event = (over: Record<string, unknown> = {}) => ({
    id: id(),
    version: 1,
    type: 'baptism',
    typeDetail: null,
    date: '1801-03-12',
    placeId: null,
    houseId,
    description: null,
    ...over,
  });

  it('accepts dated and undated Events at a Place or a House', () => {
    ok(EventRecord, event());
    ok(EventRecord, event({ houseId: null, placeId, date: '1801~' }));
    ok(EventRecord, event({ houseId: null, date: null, type: 'census' }));
    ok(EventRecord, event({ type: 'other', typeDetail: 'confirmation' }));
  });

  it('refuses a date outside the EDTF subset, both Place and House, and "other" without detail', () => {
    bad(EventRecord, event({ date: 'about 1801' }), /EDTF subset/);
    bad(EventRecord, event({ placeId }), /either a Place or a House/);
    bad(EventRecord, event({ type: 'other' }), /typeDetail/);
    bad(EventRecord, event({ type: 'christening' }));
  });

  it.each(['child', 'father', 'mother', 'partner', 'godparent', 'witness', 'priest', 'deceased', 'informant', 'other'])('accepts the Role %s', (role) => {
    ok(RoleRecord, { id: id(), version: 1, eventId: id(), personId, role, roleDetail: null });
  });

  it('refuses an unknown Role', () => {
    bad(RoleRecord, { id: id(), version: 1, eventId: id(), personId, role: 'sponsor', roleDetail: null });
  });
});

describe('Place, House, Parish, Estate and Municipality link', () => {
  it('accepts a Place with a location and a Municipality link', () => {
    ok(PlaceRecord, { id: placeId, version: 1, type: 'village', location: { lat: 49.6, lon: 15.9 }, municipality: { code: '999001', name: 'Kamenná Lhota' } });
    ok(PlaceRecord, { id: placeId, version: 1, type: 'hamlet', location: null, municipality: null });
  });

  it('refuses a location off the globe and a malformed municipality code', () => {
    bad(PlaceRecord, { id: placeId, version: 1, type: 'village', location: { lat: 95, lon: 15 }, municipality: null });
    bad(MunicipalityLink, { code: '12345', name: 'X' }, /6 digits/);
    bad(MunicipalityLink, { code: '123456', name: '' });
  });

  it('accepts Place names in Czech, German and Latin with periods', () => {
    for (const [nm, language] of [['Kamenná Lhota', 'cs'], ['Steinlhota', 'de'], ['Lhota Lapidea', 'la']] as const) {
      ok(PlaceNameRecord, { id: id(), version: 1, placeId, name: nm, language, primary: language === 'cs', period: { from: null, to: null } });
    }
    bad(PlaceNameRecord, { id: id(), version: 1, placeId, name: 'Kamienna', language: 'pl', primary: false, period: { from: null, to: null } });
  });

  it('accepts House numbers with periods and refuses a backwards period', () => {
    ok(HouseRecord, { id: houseId, version: 1, placeId, location: null, note: null });
    ok(HouseNumberRecord, { id: id(), version: 1, houseId, number: '12', period: { from: null, to: '1805' } });
    ok(HouseNumberRecord, { id: id(), version: 1, houseId, number: '15', period: { from: '1806', to: null } });
    bad(HouseNumberRecord, { id: id(), version: 1, houseId, number: 'čp. 12', period: { from: null, to: null } });
    bad(Period, { from: '1857', to: '1805' }, /ends before it starts/);
  });

  it('accepts Parishes and Estates linked to Places for periods', () => {
    const parishId = id();
    const estateId = id();
    ok(ParishRecord, { id: parishId, version: 1, name: 'Farnost Dolní Kamenec', seatPlaceId: placeId });
    ok(PlaceParishRecord, { id: id(), version: 1, placeId, parishId, period: { from: null, to: '1857' } });
    ok(EstateRecord, { id: estateId, version: 1, name: 'Panství Vrbice' });
    ok(PlaceEstateRecord, { id: id(), version: 1, placeId, estateId, period: { from: '1700', to: '1848' } });
    bad(ParishRecord, { id: parishId, version: 1, name: '', seatPlaceId: null });
    bad(PlaceParishRecord, { id: id(), version: 1, placeId, parishId, period: { from: 'after 1857', to: null } });
  });
});

describe('Source and Citation', () => {
  it('accepts a parish register and a Family account naming who gave it and when', () => {
    ok(SourceRecord, {
      id: sourceId,
      version: 1,
      type: 'parish_register',
      title: 'Matrika N 1790–1830, Dolní Kamenec',
      repository: 'Invented Regional Archive',
      reference: 'Sig. 12/4',
      url: null,
      familyAccount: null,
    });
    ok(SourceRecord, {
      id: id(),
      version: 1,
      type: 'family_account',
      title: 'What grandmother Marie recalled',
      repository: null,
      reference: null,
      url: null,
      familyAccount: { givenBy: 'Marie Dvořáková (invented)', givenByPersonId: null, givenOn: '2026-05-01' },
    });
  });

  it('refuses a Family account without who and when, and account details on other Sources', () => {
    bad(SourceRecord, { id: id(), version: 1, type: 'family_account', title: 'Oral history', repository: null, reference: null, url: null, familyAccount: null }, /who gave the account/);
    bad(SourceRecord, {
      id: id(),
      version: 1,
      type: 'census',
      title: 'Census 1869',
      repository: null,
      reference: null,
      url: null,
      familyAccount: { givenBy: 'X', givenByPersonId: null, givenOn: '2026' },
    });
  });

  it.each(['very_low', 'low', 'normal', 'high', 'very_high'])('accepts a Citation with confidence %s', (confidence) => {
    ok(CitationRecord, { id: citationId, version: 1, sourceId, page: 'fol. 23v', transcription: 'Joannes, filius legitimus…', readOn: '2026-04-11', confidence, note: null });
  });

  it('refuses a Citation without transcription, with an unknown confidence or a malformed read date', () => {
    const base = { id: citationId, version: 1, sourceId, page: '23', transcription: 'x', readOn: '2026-04-11', confidence: 'normal', note: null };
    bad(CitationRecord, { ...base, transcription: '' });
    bad(CitationRecord, { ...base, confidence: 'certain' });
    bad(CitationRecord, { ...base, readOn: '11.4.2026' });
  });
});

describe('image metadata', () => {
  const image = (over: Record<string, unknown> = {}) => ({
    id: id(),
    version: 1,
    kind: 'page',
    citationId,
    personIds: [],
    contentType: 'image/jpeg',
    byteSize: 2_400_000,
    width: 3000,
    height: 4000,
    sha256: 'a'.repeat(64),
    caption: null,
    ...over,
  });

  it('accepts a page image on a Citation and a portrait of a Person', () => {
    ok(ImageMetadata, image());
    ok(ImageMetadata, image({ kind: 'portrait', citationId: null, personIds: [personId], contentType: 'image/heic' }));
  });

  it('refuses a page image without Citation, a portrait without Person, over 25 MB, or an unsupported type', () => {
    bad(ImageMetadata, image({ citationId: null }), /belong to a Citation/);
    bad(ImageMetadata, image({ kind: 'portrait', citationId: null }), /at least one Person/);
    bad(ImageMetadata, image({ byteSize: 25 * 1024 * 1024 + 1 }));
    bad(ImageMetadata, image({ contentType: 'image/gif' }));
  });
});
