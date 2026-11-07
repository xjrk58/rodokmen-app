/**
 * What of the Tree may leave the server in an Export (exports spec; GLOSSARY "Export", "Living
 * person"): the Export view of a record. Both writers, the Markdown notes and the GEDCOM file,
 * write only what {@link exportRecord} returns, so they cannot drift apart (design, "Reduction
 * happens in one place").
 *
 * - A Living person keeps their name (given name and surname of the primary Name), sex,
 *   relationships to other Persons (the Families they are a child or partner in) and birth year.
 *   No exact date, no other Event, Place, House, Citation, note, Label or image.
 * - An Event in which a Living person has a Role is left out of every record, so that a parent's
 *   or a partner's note cannot give the Living person's exact birth or marriage either.
 * - A record that concerns a Living person (a Family with a Living partner or child) keeps no notes.
 * - No record holds an image or a document, or a link to one.
 *
 * Every record kind (Person, Family, Place, House, Parish, Estate, Source) has the one shape
 * {@link ExportRecord}; a field a kind does not use is empty. Unknown values are the empty string,
 * or a flag and 0, never null.
 *
 * The functions marked `//@ verify` are proved with LemmaScript (ADR 0009, docs/verification.md).
 * Who is Living (the proved Living rule, asked by the server), which records, Events and links the
 * server gathers, which links point at an image, and the text the writers make of the view are
 * not proved; server/test/exports.test.ts covers them.
 */

/** A link from a record: `record` (another note), `web` (an outside page), `image` or `document`. */
export interface ExportLink {
  readonly kind: string;
  readonly target: string;
  readonly label: string;
}

/** A Citation as an Export may show it, with its page images as links. */
export interface ExportCitation {
  readonly id: string;
  readonly sourceId: string;
  readonly page: string;
  readonly transcription: string;
  readonly confidence: string;
  readonly note: string;
  readonly links: readonly ExportLink[];
}

/** One Role in an Event, and whether the Person who has it is Living. */
export interface ExportRole {
  readonly personId: string;
  readonly role: string;
  readonly living: boolean;
}

export interface ExportEvent {
  readonly id: string;
  readonly type: string;
  readonly typeDetail: string;
  /** The EDTF date as written; '' when undated. */
  readonly date: string;
  /** Its Place or House; '' for none. */
  readonly placeId: string;
  readonly houseId: string;
  readonly description: string;
  readonly notes: string;
  readonly roles: readonly ExportRole[];
  readonly citations: readonly ExportCitation[];
}

export interface ExportName {
  readonly given: string;
  readonly surname: string;
  readonly type: string;
  readonly language: string;
  readonly asFound: string;
  readonly citations: readonly ExportCitation[];
}

/** A link to another record: `childOf` and `partnerIn` (a Person's Families), `partner`, `child`, `place`, `parish` … */
export interface ExportRelation {
  readonly rel: string;
  readonly target: string;
  readonly detail: string;
}

/** Any other field of a record, such as a title, a type or a period. */
export interface ExportFact {
  readonly key: string;
  readonly value: string;
  readonly detail: string;
}

export interface ExportRecord {
  /** person, family, place, house, parish, estate or source. */
  readonly kind: string;
  readonly id: string;
  /** A Living person (always false for other kinds). */
  readonly living: boolean;
  /** The record concerns a Living person: a Family with a Living partner or child. */
  readonly concernsLiving: boolean;
  readonly sex: string;
  /** A Person's Names, the primary first. */
  readonly names: readonly ExportName[];
  readonly relations: readonly ExportRelation[];
  readonly birthYear: number;
  readonly hasBirthYear: boolean;
  readonly events: readonly ExportEvent[];
  readonly facts: readonly ExportFact[];
  readonly notes: string;
  readonly links: readonly ExportLink[];
}

// ---------------------------------------------------------------- no images

/** Whether a link points at an image or a document (page images, portraits, photos, PDFs). */
export function isMediaLink(link: ExportLink): boolean {
  //@ verify
  return link.kind === 'image' || link.kind === 'document';
}

/** Whether any of the links points at an image or a document. */
export function hasMedia(links: readonly ExportLink[]): boolean {
  //@ verify
  return links.some((link) => isMediaLink(link));
}

/**
 * The links that may leave the server (exports spec, "No images in any Export"): every link but
 * those to images and documents, in their order.
 */
export function exportLinks(links: readonly ExportLink[]): ExportLink[] {
  //@ verify
  //@ contract exports: No images in any Export
  // No link to an image or a document ...
  //@ ensures forall(i: nat, i < \result.length ==> !isMediaLink(\result[i]))
  //@ ensures !hasMedia(\result)
  // ... every other link kept, and none invented.
  //@ ensures forall(j: nat, j < links.length && !isMediaLink(links[j]) ==> \result.includes(links[j]))
  //@ ensures forall(i: nat, i < \result.length ==> links.includes(\result[i]))
  const out: ExportLink[] = [];
  for (const link of links) {
    //@ invariant forall(i: nat, i < out.length ==> !isMediaLink(out[i]))
    //@ invariant forall(j: nat, j < _link_idx && !isMediaLink(links[j]) ==> out.includes(links[j]))
    //@ invariant forall(i: nat, i < out.length ==> links.includes(out[i]))
    if (!isMediaLink(link)) out.push(link);
  }
  return out;
}

/** A Citation without its page images: its Source, page, transcription and confidence stay (scenario "Citation with a page image"). */
export function citationView(c: ExportCitation): ExportCitation {
  //@ verify
  //@ ensures !hasMedia(\result.links)
  //@ ensures \result.transcription === c.transcription && \result.confidence === c.confidence && \result.sourceId === c.sourceId && \result.page === c.page
  return { id: c.id, sourceId: c.sourceId, page: c.page, transcription: c.transcription, confidence: c.confidence, note: c.note, links: exportLinks(c.links) };
}

export function citationsView(citations: readonly ExportCitation[]): ExportCitation[] {
  //@ verify
  //@ ensures \result.length === citations.length
  //@ ensures forall(i: nat, i < \result.length ==> !hasMedia(\result[i].links))
  //@ ensures forall(i: nat, i < \result.length ==> \result[i].transcription === citations[i].transcription && \result[i].confidence === citations[i].confidence)
  const out: ExportCitation[] = [];
  for (const c of citations) {
    //@ invariant out.length === _c_idx
    //@ invariant forall(i: nat, i < out.length ==> !hasMedia(out[i].links))
    //@ invariant forall(i: nat, i < out.length ==> out[i].transcription === citations[i].transcription && out[i].confidence === citations[i].confidence)
    out.push(citationView(c));
  }
  return out;
}

// ---------------------------------------------------------------- Events with Living people

/** Whether a Living person has a Role in the Event. */
export function hasLivingRole(e: ExportEvent): boolean {
  //@ verify
  return e.roles.some((r) => r.living);
}

export function eventView(e: ExportEvent): ExportEvent {
  //@ verify
  //@ ensures \result.roles === e.roles
  //@ ensures forall(k: nat, k < \result.citations.length ==> !hasMedia(\result.citations[k].links))
  return {
    id: e.id,
    type: e.type,
    typeDetail: e.typeDetail,
    date: e.date,
    placeId: e.placeId,
    houseId: e.houseId,
    description: e.description,
    notes: e.notes,
    roles: e.roles,
    citations: citationsView(e.citations),
  };
}

/** The Events that may leave the server: those without a Living person, each without images. */
export function eventsView(events: readonly ExportEvent[]): ExportEvent[] {
  //@ verify
  //@ ensures forall(i: nat, i < \result.length ==> !hasLivingRole(\result[i]))
  //@ ensures forall(i: nat, i < \result.length ==> forall(k: nat, k < \result[i].citations.length ==> !hasMedia(\result[i].citations[k].links)))
  //@ ensures \result.length <= events.length
  const out: ExportEvent[] = [];
  for (const e of events) {
    //@ invariant out.length <= _e_idx
    //@ invariant forall(i: nat, i < out.length ==> !hasLivingRole(out[i]))
    //@ invariant forall(i: nat, i < out.length ==> forall(k: nat, k < out[i].citations.length ==> !hasMedia(out[i].citations[k].links)))
    if (!hasLivingRole(e)) out.push(eventView(e));
  }
  return out;
}

export function namesView(names: readonly ExportName[]): ExportName[] {
  //@ verify
  //@ ensures \result.length === names.length
  //@ ensures forall(i: nat, i < \result.length ==> forall(k: nat, k < \result[i].citations.length ==> !hasMedia(\result[i].citations[k].links)))
  const out: ExportName[] = [];
  for (const n of names) {
    //@ invariant out.length === _n_idx
    //@ invariant forall(i: nat, i < out.length ==> forall(k: nat, k < out[i].citations.length ==> !hasMedia(out[i].citations[k].links)))
    out.push({ given: n.given, surname: n.surname, type: n.type, language: n.language, asFound: n.asFound, citations: citationsView(n.citations) });
  }
  return out;
}

// ---------------------------------------------------------------- the reduction of a Living person

/** The relationships a Living person keeps: the Families they are a child or a partner in. */
export function isLivingRelation(rel: ExportRelation): boolean {
  //@ verify
  return rel.rel === 'childOf' || rel.rel === 'partnerIn';
}

export function livingRelations(relations: readonly ExportRelation[]): ExportRelation[] {
  //@ verify
  //@ ensures forall(i: nat, i < \result.length ==> isLivingRelation(\result[i]))
  //@ ensures forall(j: nat, j < relations.length && isLivingRelation(relations[j]) ==> \result.includes(relations[j]))
  const out: ExportRelation[] = [];
  for (const rel of relations) {
    //@ invariant forall(i: nat, i < out.length ==> isLivingRelation(out[i]))
    //@ invariant forall(j: nat, j < _rel_idx && isLivingRelation(relations[j]) ==> out.includes(relations[j]))
    if (isLivingRelation(rel)) out.push(rel);
  }
  return out;
}

/**
 * The reduced view of a Living person (exports spec, "Living people are reduced in every
 * Export"): the given name and surname of their primary Name, their sex, the Families they are a
 * child or partner in, and their birth year. Nothing else: no exact date, no Event, Place, House,
 * Citation, note, Label or image. The only function that reduces a Person; both writers use it
 * through {@link exportRecord}.
 */
export function reducePerson(r: ExportRecord): ExportRecord {
  //@ verify
  //@ contract exports: Living people are reduced in every Export
  //@ contract exports: GEDCOM download for the Owner
  //@ ensures \result.living && \result.id === r.id && \result.kind === r.kind && \result.sex === r.sex
  //@ ensures \result.birthYear === r.birthYear && \result.hasBirthYear === r.hasBirthYear
  //@ ensures \result.events.length === 0 && \result.facts.length === 0 && \result.links.length === 0 && \result.notes === ''
  //@ ensures \result.names.length <= 1
  //@ ensures forall(i: nat, i < \result.names.length ==> \result.names[i].citations.length === 0 && \result.names[i].asFound === '' && \result.names[i].type === '' && \result.names[i].language === '')
  //@ ensures r.names.length > 0 ==> \result.names.length === 1 && \result.names[0].given === r.names[0].given && \result.names[0].surname === r.names[0].surname
  //@ ensures forall(i: nat, i < \result.relations.length ==> isLivingRelation(\result.relations[i]))
  //@ ensures forall(j: nat, j < r.relations.length && isLivingRelation(r.relations[j]) ==> \result.relations.includes(r.relations[j]))
  const names: ExportName[] = [];
  if (r.names.length > 0) {
    const primary = r.names[0]!;
    names.push({ given: primary.given, surname: primary.surname, type: '', language: '', asFound: '', citations: [] });
  }
  return {
    kind: r.kind,
    id: r.id,
    living: true,
    concernsLiving: r.concernsLiving,
    sex: r.sex,
    names,
    relations: livingRelations(r.relations),
    birthYear: r.birthYear,
    hasBirthYear: r.hasBirthYear,
    events: [],
    facts: [],
    notes: '',
    links: [],
  };
}

// ---------------------------------------------------------------- the Export view of a record

/**
 * The Export view of any record: what the Markdown and GEDCOM writers may write of it. A Living
 * person is reduced ({@link reducePerson}); every other record keeps its fields and relations,
 * loses the Events a Living person took part in, its notes when it concerns a Living person, and
 * every image and document and link to one.
 */
export function exportRecord(r: ExportRecord): ExportRecord {
  //@ verify
  //@ contract exports: Living people are reduced in every Export
  //@ contract exports: No images in any Export
  //@ contract exports: GEDCOM download for the Owner
  // No image, document or link to one, anywhere in the view.
  //@ ensures !hasMedia(\result.links)
  //@ ensures forall(i: nat, i < \result.events.length ==> forall(k: nat, k < \result.events[i].citations.length ==> !hasMedia(\result.events[i].citations[k].links)))
  //@ ensures forall(i: nat, i < \result.names.length ==> forall(k: nat, k < \result.names[i].citations.length ==> !hasMedia(\result.names[i].citations[k].links)))
  // No Event a Living person took part in, in any record.
  //@ ensures forall(i: nat, i < \result.events.length ==> !hasLivingRole(\result.events[i]))
  //@ ensures \result.id === r.id && \result.kind === r.kind && \result.living === r.living && \result.sex === r.sex
  // A Living person: name, sex, relationships and birth year only.
  //@ ensures r.living ==> \result.events.length === 0 && \result.facts.length === 0 && \result.links.length === 0 && \result.notes === ''
  //@ ensures r.living ==> \result.names.length <= 1 && forall(i: nat, i < \result.names.length ==> \result.names[i].citations.length === 0 && \result.names[i].asFound === '' && \result.names[i].type === '' && \result.names[i].language === '')
  //@ ensures r.living && r.names.length > 0 ==> \result.names.length === 1 && \result.names[0].given === r.names[0].given && \result.names[0].surname === r.names[0].surname
  //@ ensures r.living ==> forall(i: nat, i < \result.relations.length ==> isLivingRelation(\result.relations[i]))
  //@ ensures r.living ==> \result.birthYear === r.birthYear && \result.hasBirthYear === r.hasBirthYear
  // Scenario "Living grandchild in GEDCOM": born in 2010, the view holds the birth year 2010 and no place or other fact.
  //@ ensures r.living && r.hasBirthYear && r.birthYear === 2010 ==> \result.hasBirthYear && \result.birthYear === 2010 && \result.events.length === 0 && \result.facts.length === 0
  // A record about a Living person keeps no notes.
  //@ ensures r.concernsLiving ==> \result.notes === ''
  // Any other record keeps its fields, relations and Names.
  //@ ensures !r.living ==> \result.facts === r.facts && \result.relations === r.relations && \result.names.length === r.names.length
  if (r.living) return reducePerson(r);
  return {
    kind: r.kind,
    id: r.id,
    living: false,
    concernsLiving: r.concernsLiving,
    sex: r.sex,
    names: namesView(r.names),
    relations: r.relations,
    birthYear: r.birthYear,
    hasBirthYear: r.hasBirthYear,
    events: eventsView(r.events),
    facts: r.facts,
    notes: r.concernsLiving ? '' : r.notes,
    links: exportLinks(r.links),
  };
}
