import { foldForSearch } from '@rodokmen/shared';
import { linked, notesOf, unmapped, type MapContext } from './map-places.js';
import { at, type PlannedProposal } from './plan.js';
import { dateText, isRecord, isValidDate, linkOf, type VaultNote } from './reader.js';

/**
 * Persons, their Names, Events, Roles and Family links (design, "Mapping"). A Person is created by
 * the earliest Source note that names them, with the facts that note supports; what no Source note
 * covers goes in a Proposal of the Person's own, citing the Vault provenance Source.
 */
export type FactKind = 'birth' | 'baptism' | 'death' | 'burial';
export const FACTS: readonly FactKind[] = ['birth', 'baptism', 'death', 'burial'];

const KNOWN = [
  'type',
  'name',
  'living',
  'confidence',
  'tags',
  'sex',
  'residences',
  'birth',
  'baptism',
  'death',
  'burial',
  'marriages',
  'father',
  'mother',
  'adoptive_father',
  'adoptive_mother',
  'aliases',
];
/** Tags the Tree derives itself, never Labels (vault-import spec, "Tags become Labels or are derived"). */
const DERIVED_TAGS = ['nepribuzny', 'mozny-pribuzny'];
const DERIVED_PREFIXES = ['obec/', 'import/'];

export interface Fact {
  kind: FactKind;
  date: unknown;
  place: unknown;
  house: unknown;
  source: unknown;
}

export interface Marriage {
  index: number;
  spouse: unknown;
  date: unknown;
  place: unknown;
  source: unknown;
}

const obj = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});

export function factsOf(note: VaultNote): Fact[] {
  return FACTS.flatMap((kind) => {
    const f = obj(note.data[kind]);
    return Object.keys(f).length ? [{ kind, date: f.date, place: f.place, house: f.house, source: f.source }] : [];
  });
}

export function marriagesOf(note: VaultNote): Marriage[] {
  const list: unknown[] = Array.isArray(note.data.marriages) ? note.data.marriages : [];
  return list.map((m, index) => {
    const o = obj(m);
    return { index, spouse: o.spouse, date: o.date, place: o.place, source: o.source };
  });
}

/** The Labels of a Person: every tag the Tree does not derive. */
export function labelsOf(note: VaultNote): string[] {
  const tags = Array.isArray(note.data.tags) ? note.data.tags.filter((t): t is string => typeof t === 'string') : [];
  return tags.filter((t) => !DERIVED_TAGS.includes(t) && !DERIVED_PREFIXES.some((p) => t.startsWith(p)));
}

/** A Name's language from its spelling (design, "Mapping"): Latin by its endings, German by its letters, else not known. */
export function variantLanguage(spelling: string): 'la' | 'de' | null {
  if (spelling.split(/\s+/).some((w) => w.length > 3 && /(us|ius)$/i.test(w))) return 'la';
  if (/ß|sch|mann\b/i.test(spelling)) return 'de';
  return null;
}

const common = (a: string, b: string) => {
  const [x, y] = [foldForSearch(a), foldForSearch(b)];
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
};

/** A variant spelling as a Name: one word replaces the given name or the surname it is closer to; more words are given names and a surname. */
export function variantName(spelling: string, given: string, surname: string): { given: string; surname: string } {
  const words = spelling.trim().split(/\s+/);
  if (words.length > 1) return { given: words.slice(0, -1).join(' '), surname: words.at(-1)! };
  const word = words[0] ?? '';
  const g = common(word, given);
  const s = common(word, surname);
  const asGiven = g > s || (g === s && /(us|ius)$/i.test(word));
  return asGiven ? { given: word, surname } : { given, surname: word };
}

/** The Person, created once, with Names, Labels and research notes, in the Proposal that first names them. */
export function ensurePerson(ctx: MapContext, p: PlannedProposal, note: VaultNote): string {
  const key = `person:${note.id}`;
  if (ctx.b.has(key)) return key;
  const { b } = ctx;
  const n = obj(note.data.name);
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  let given = str(n.given);
  const surname = str(n.surname);
  const birthSurname = str(n.birth_surname);
  if (!given && !surname) {
    b.report('unmappedValue', note.path, 'people.name: no given name or surname');
    given = '?';
  }
  const sex = note.data.sex === 'M' ? 'male' : note.data.sex === 'F' ? 'female' : 'unknown';
  if (note.data.sex !== undefined && sex === 'unknown') b.report('unmappedValue', note.path, `people.sex: ${JSON.stringify(note.data.sex)}`);
  b.create(p, key, 'person', {
    op: 'createPerson',
    tempId: '',
    sex,
    name: { given, surname, type: birthSurname ? 'married' : 'birth', language: 'cs', asFound: `${given} ${surname}`.trim() },
  });
  if (birthSurname)
    b.link(p, `name:${note.id}:birth`, 'name', {
      op: 'addName',
      personId: at(key),
      given,
      surname: birthSurname,
      type: 'birth',
      language: 'cs',
      asFound: `${given} ${birthSurname}`.trim(),
    });
  const variants = Array.isArray(n.variants) ? n.variants.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];
  variants.forEach((v, i) =>
    b.link(p, `name:${note.id}:variant:${i}`, 'name', {
      op: 'addName',
      personId: at(key),
      ...variantName(v, given, surname),
      type: 'other',
      language: variantLanguage(v),
      asFound: v.trim(),
    }),
  );
  for (const label of labelsOf(note)) b.link(p, `label:${note.id}:${foldForSearch(label)}`, 'label', { op: 'addLabel', personId: at(key), label });
  notesOf(ctx, p, 'person', key, note);
  unmapped(ctx, note, KNOWN);
  return key;
}

/** The Person a link names, created here when not yet; null when the link is broken. */
export function linkedPerson(ctx: MapContext, p: PlannedProposal, from: VaultNote, value: unknown, field: string): string | null {
  const target = linked(ctx, from, value, 'people', field);
  return target ? ensurePerson(ctx, p, target) : null;
}

/** An Event's date: valid EDTF, or none with the date as written kept in its description. */
export function eventDate(ctx: MapContext, note: VaultNote, value: unknown, field: string): { date: string | null; description: string | null } {
  const text = dateText(value);
  if (text === null) return { date: null, description: null };
  if (isValidDate(text)) return { date: text, description: null };
  ctx.b.report('badDate', note.path, `${field}: ${text}`);
  return { date: null, description: `Date as written in the Vault: ${text}` };
}

/**
 * Where an Event happened: its House, else its Place. The Vault puts a baptism or marriage at the
 * Parish where it was entered: the Event is then at the Parish's seat, where its church stands.
 */
export function eventWhere(ctx: MapContext, note: VaultNote, place: unknown, house: unknown, field: string) {
  const h = linked(ctx, note, house, 'houses', `${field}.house`);
  const parish = h ? undefined : ctx.vault.byId.get(linkOf(place) ?? '');
  if (parish?.folder === 'parishes') {
    const seat = ctx.parishSeats.get(parish.id);
    if (!seat) ctx.b.report('unmappedValue', note.path, `${field}.place: a Parish without a seat`);
    return { placeId: seat ? at(seat) : null, houseId: null };
  }
  const pl = h ? null : linked(ctx, note, place, 'places', `${field}.place`);
  return { placeId: pl ? at(`place:${pl.id}`) : null, houseId: h ? at(`house:${h.id}`) : null };
}

/** The Family of two partners (either may be unknown), once per pair. */
export function ensureFamily(ctx: MapContext, p: PlannedProposal, partner1: string | null, partner2: string | null): string {
  const ids = [partner1, partner2].map((x) => x?.replace(/^person:/, '') ?? '?');
  const key = `family:${[...ids].sort().join('+')}`;
  ctx.b.create(p, key, 'family', { op: 'createFamily', tempId: '', partner1Id: partner1 ? at(partner1) : null, partner2Id: partner2 ? at(partner2) : null });
  return key;
}

/** A Role in an Event, once. */
export function role(ctx: MapContext, p: PlannedProposal, eventKey: string, personKey: string, r: string, roleDetail: string | null = null): void {
  ctx.b.link(p, `role:${eventKey}:${personKey}:${r}`, 'role', { op: 'addRole', eventId: at(eventKey), personId: at(personKey), role: r, roleDetail });
}

/** A child's link to the Family of its parents (or adoptive parents), once. */
export function childLink(ctx: MapContext, p: PlannedProposal, familyKey: string, childKey: string, linkType: 'birth' | 'adoptive'): void {
  ctx.b.link(p, `child:${familyKey}:${childKey}`, 'child link', { op: 'linkChild', familyId: at(familyKey), childId: at(childKey), linkType });
}

/** The parents of a Person: birth (father, mother) and adoptive. */
export function parentsOf(ctx: MapContext, p: PlannedProposal, note: VaultNote) {
  const father = linkOf(note.data.father) ? linkedPerson(ctx, p, note, note.data.father, 'father') : null;
  const mother = linkOf(note.data.mother) ? linkedPerson(ctx, p, note, note.data.mother, 'mother') : null;
  const adoptiveFather = linkOf(note.data.adoptive_father) ? linkedPerson(ctx, p, note, note.data.adoptive_father, 'adoptive_father') : null;
  const adoptiveMother = linkOf(note.data.adoptive_mother) ? linkedPerson(ctx, p, note, note.data.adoptive_mother, 'adoptive_mother') : null;
  return { father, mother, adoptiveFather, adoptiveMother };
}

/**
 * A birth or baptism, death or burial of a Person, with its Roles: the child with father and
 * mother (so that the parents' link has the Event's Citation), or the deceased.
 */
export function factEvent(ctx: MapContext, p: PlannedProposal, note: VaultNote, fact: Fact, citationKey: string): void {
  const person = ensurePerson(ctx, p, note);
  const key = `event:${note.id}:${fact.kind}`;
  const { date, description } = eventDate(ctx, note, fact.date, `${fact.kind}.date`);
  ctx.b.create(p, key, 'event', {
    op: 'createEvent',
    tempId: '',
    type: fact.kind,
    date,
    ...eventWhere(ctx, note, fact.place, fact.house, fact.kind),
    description,
  });
  if (fact.kind === 'birth' || fact.kind === 'baptism') {
    role(ctx, p, key, person, 'child');
    const { father, mother } = parentsOf(ctx, p, note);
    if (father) role(ctx, p, key, father, 'father');
    if (mother) role(ctx, p, key, mother, 'mother');
    if (father || mother) childLink(ctx, p, ensureFamily(ctx, p, father, mother), person, 'birth');
  } else {
    role(ctx, p, key, person, 'deceased');
  }
  ctx.b.link(p, `cite:${key}:${citationKey}`, 'citation link', { op: 'attachCitation', citationId: at(citationKey), eventId: at(key) });
}

/** A marriage, once for both spouses who record it, with partner Roles and their Family. */
export function marriageEvent(ctx: MapContext, p: PlannedProposal, note: VaultNote, m: Marriage, citationKey: string, sourceId: string | null): void {
  const person = ensurePerson(ctx, p, note);
  const spouse = linkOf(m.spouse) ? linkedPerson(ctx, p, note, m.spouse, `marriages.${m.index}.spouse`) : null;
  const pair = [person, spouse ?? `?${note.id}:${m.index}`].sort().join('+');
  const key = `event:marriage:${pair}:${sourceId ?? `vault:${note.id}:${m.index}`}`;
  const { date, description } = eventDate(ctx, note, m.date, `marriages.${m.index}.date`);
  ctx.b.create(p, key, 'event', {
    op: 'createEvent',
    tempId: '',
    type: 'marriage',
    date,
    ...eventWhere(ctx, note, m.place, undefined, 'marriage'),
    description,
  });
  role(ctx, p, key, person, 'partner');
  if (spouse) {
    role(ctx, p, key, spouse, 'partner');
    const male = (obj(note.data).sex ?? '') === 'M';
    ensureFamily(ctx, p, male ? person : spouse, male ? spouse : person);
  }
  ctx.b.link(p, `cite:${key}:${citationKey}`, 'citation link', { op: 'attachCitation', citationId: at(citationKey), eventId: at(key) });
}
