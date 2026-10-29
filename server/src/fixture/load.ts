import {
  ChildLinkRecord,
  CitationRecord,
  EstateRecord,
  EventRecord,
  FamilyRecord,
  HouseNumberRecord,
  HouseRecord,
  ImageMetadata,
  ParishRecord,
  PersonWithNames,
  PlaceEstateRecord,
  PlaceNameRecord,
  PlaceParishRecord,
  PlaceRecord,
  RoleRecord,
  SourceRecord,
  type Period,
  type GeoPoint,
} from '@rodokmen/shared';
import { sql, type Kysely } from 'kysely';
import { type z } from 'zod';
import type { Database } from '../db/types.js';
import { dateColumns, periodColumns } from '../tree/dates.js';
import { generateFixture, type FixtureModel } from './generate.js';

function check<T extends z.ZodType>(schema: T, value: unknown, what: string): void {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`fixture ${what} is invalid: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
}

const point = (p: GeoPoint | null) => (p ? sql`ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326)::geography` : null);

function period(p: Period) {
  return periodColumns(p);
}

async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) await insert(rows.slice(i, i + 500));
}

/** Validates the whole model with the shared schemas and inserts it in one transaction. */
export async function loadFixture(db: Kysely<Database>, model: FixtureModel = generateFixture()): Promise<FixtureModel> {
  for (const p of model.persons) check(PersonWithNames, { person: p, names: model.names.filter((n) => n.personId === p.id) }, `person ${p.id}`);
  model.families.forEach((r) => check(FamilyRecord, r, 'family'));
  model.childLinks.forEach((r) => check(ChildLinkRecord, r, 'child link'));
  model.places.forEach((r) => check(PlaceRecord, r, 'place'));
  model.placeNames.forEach((r) => check(PlaceNameRecord, r, 'place name'));
  model.houses.forEach((r) => check(HouseRecord, r, 'house'));
  model.houseNumbers.forEach((r) => check(HouseNumberRecord, r, 'house number'));
  model.parishes.forEach((r) => check(ParishRecord, r, 'parish'));
  model.placeParishes.forEach((r) => check(PlaceParishRecord, r, 'place parish'));
  model.estates.forEach((r) => check(EstateRecord, r, 'estate'));
  model.placeEstates.forEach((r) => check(PlaceEstateRecord, r, 'place estate'));
  model.events.forEach((r) => check(EventRecord, r, `event ${r.id}`));
  model.roles.forEach((r) => check(RoleRecord, r, 'role'));
  model.sources.forEach((r) => check(SourceRecord, r, `source ${r.title}`));
  model.citations.forEach((r) => check(CitationRecord, r, 'citation'));
  model.images.forEach((r) => check(ImageMetadata, r, 'image'));

  await db.transaction().execute(async (tx) => {
    await insertChunks(model.persons, (c) => tx.insertInto('person').values(c.map((p) => ({ id: p.id, sex: p.sex }))).execute());
    await insertChunks(model.names, (c) =>
      tx
        .insertInto('name')
        .values(c.map((n, i) => ({ id: n.id, person_id: n.personId, given: n.given, surname: n.surname, type: n.type, as_found: n.asFound, is_primary: n.primary, sort_order: n.primary ? 0 : i + 1 })))
        .execute(),
    );
    await insertChunks(model.places, (c) =>
      tx
        .insertInto('place')
        .values(c.map((p) => ({ id: p.id, type: p.type, location: point(p.location), municipality_code: p.municipality?.code ?? null, municipality_name: p.municipality?.name ?? null })))
        .execute(),
    );
    await insertChunks(model.placeNames, (c) =>
      tx
        .insertInto('place_name')
        .values(c.map((n) => ({ id: n.id, place_id: n.placeId, name: n.name, language: n.language, is_primary: n.primary, ...period(n.period) })))
        .execute(),
    );
    await insertChunks(model.houses, (c) =>
      tx.insertInto('house').values(c.map((h) => ({ id: h.id, place_id: h.placeId, location: point(h.location), note: h.note }))).execute(),
    );
    await insertChunks(model.houseNumbers, (c) =>
      tx.insertInto('house_number').values(c.map((n) => ({ id: n.id, house_id: n.houseId, number: n.number, ...period(n.period) }))).execute(),
    );
    await insertChunks(model.parishes, (c) => tx.insertInto('parish').values(c.map((p) => ({ id: p.id, name: p.name, seat_place_id: p.seatPlaceId }))).execute());
    await insertChunks(model.placeParishes, (c) =>
      tx.insertInto('place_parish').values(c.map((l) => ({ id: l.id, place_id: l.placeId, parish_id: l.parishId, ...period(l.period) }))).execute(),
    );
    await insertChunks(model.estates, (c) => tx.insertInto('estate').values(c.map((e) => ({ id: e.id, name: e.name }))).execute());
    await insertChunks(model.placeEstates, (c) =>
      tx.insertInto('place_estate').values(c.map((l) => ({ id: l.id, place_id: l.placeId, estate_id: l.estateId, ...period(l.period) }))).execute(),
    );
    await insertChunks(model.families, (c) =>
      tx.insertInto('family').values(c.map((f) => ({ id: f.id, partner1_id: f.partner1Id, partner2_id: f.partner2Id }))).execute(),
    );
    await insertChunks(model.childLinks, (c) =>
      tx
        .insertInto('family_child')
        .values(c.map((l, i) => ({ id: l.id, family_id: l.familyId, child_id: l.childId, link_type: l.linkType, sort_order: i })))
        .execute(),
    );
    await insertChunks(model.events, (c) =>
      tx
        .insertInto('event')
        .values(c.map((e) => ({ id: e.id, type: e.type, type_detail: e.typeDetail, ...dateColumns(e.date), place_id: e.placeId, house_id: e.houseId, description: e.description })))
        .execute(),
    );
    await insertChunks(model.roles, (c) =>
      tx
        .insertInto('event_role')
        .values(c.map((r, i) => ({ id: r.id, event_id: r.eventId, person_id: r.personId, role: r.role, role_detail: r.roleDetail, sort_order: i })))
        .execute(),
    );
    await insertChunks(model.sources, (c) =>
      tx
        .insertInto('source')
        .values(
          c.map((s) => ({
            id: s.id,
            type: s.type,
            title: s.title,
            repository: s.repository,
            reference: s.reference,
            url: s.url,
            account_given_by: s.familyAccount?.givenBy ?? null,
            account_given_by_person_id: s.familyAccount?.givenByPersonId ?? null,
            account_given_on: s.familyAccount?.givenOn ?? null,
          })),
        )
        .execute(),
    );
    await insertChunks(model.citations, (c) =>
      tx
        .insertInto('citation')
        .values(c.map((x) => ({ id: x.id, source_id: x.sourceId, page: x.page, transcription: x.transcription, read_on: x.readOn, confidence: x.confidence, note: x.note })))
        .execute(),
    );
    await insertChunks(model.eventCitations, (c) =>
      tx.insertInto('event_citation').values(c.map((x) => ({ id: x.id, event_id: x.eventId, citation_id: x.citationId }))).execute(),
    );
    await insertChunks(model.nameCitations, (c) =>
      tx.insertInto('name_citation').values(c.map((x) => ({ id: x.id, name_id: x.nameId, citation_id: x.citationId }))).execute(),
    );
    for (const img of model.images) {
      await tx
        .insertInto('image')
        .values({
          id: img.id,
          kind: img.kind,
          citation_id: img.citationId,
          storage_key: img.storageKey,
          content_type: img.contentType,
          byte_size: img.byteSize,
          width: img.width,
          height: img.height,
          sha256: img.sha256,
          caption: img.caption,
        })
        .execute();
      for (const personId of img.personIds) await tx.insertInto('image_person').values({ image_id: img.id, person_id: personId }).execute();
    }
  });
  return model;
}
