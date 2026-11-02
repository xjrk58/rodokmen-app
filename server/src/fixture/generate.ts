/**
 * An invented fixture Tree for tests and local development. Every Person, Place, Parish,
 * Estate and Source here is made up; none is real family data (this repo is public).
 *
 * About 200 Persons over 6 generations (born c. 1745 to c. 1945), with the cases the specs
 * name built in by hand ("landmarks"):
 * - Jan Novák, baptised 1801 at čp. 12 of Kamenná Lhota as "Joannes Nowak", later "Johann Nowak";
 *   a baptism Event that links him, both parents, two godparents and the priest.
 * - House A of Kamenná Lhota: čp. 12 until 1805, čp. 15 afterwards. House B took over čp. 12.
 *   Jan's baptism (1801, čp. 12) and his death (1850, čp. 15) are at the same House.
 * - Kamenná Lhota belonged to the Parish of Dolní Kamenec until 1857 and to Vrbice afterwards,
 *   with Events there in 1840 and 1870.
 * - Jan is widowed in 1835 and remarries in 1837: two Families, each with its own children.
 * - Marie Nováková (born 1885) is a birth child of one Family and an adoptive child of another.
 * - A marriage whose only evidence is a Family account given in 2026.
 * - A far-away village (Horní Bukovina) for the map query, and Living people born after 1926.
 *
 * The generator is deterministic: the same seed always gives the same records and ids.
 */
import type {
  ChildLinkRecord,
  CitationRecord,
  EstateRecord,
  EventRecord,
  FamilyRecord,
  HouseNumberRecord,
  HouseRecord,
  ImageMetadata,
  NameRecord,
  ParishRecord,
  PersonRecord,
  PlaceEstateRecord,
  PlaceNameRecord,
  PlaceParishRecord,
  PlaceRecord,
  RoleRecord,
  RoleType,
  SourceRecord,
  EventType,
  Confidence,
} from '@rodokmen/shared';
import { daysInMonth, isoDay } from '@rodokmen/shared';

export interface FixtureModel {
  persons: PersonRecord[];
  names: NameRecord[];
  families: FamilyRecord[];
  childLinks: ChildLinkRecord[];
  places: PlaceRecord[];
  placeNames: PlaceNameRecord[];
  houses: HouseRecord[];
  houseNumbers: HouseNumberRecord[];
  parishes: ParishRecord[];
  placeParishes: PlaceParishRecord[];
  estates: EstateRecord[];
  placeEstates: PlaceEstateRecord[];
  events: EventRecord[];
  roles: RoleRecord[];
  sources: SourceRecord[];
  citations: CitationRecord[];
  eventCitations: Array<{ id: string; eventId: string; citationId: string }>;
  nameCitations: Array<{ id: string; nameId: string; citationId: string }>;
  images: Array<ImageMetadata & { storageKey: string }>;
  landmarks: Landmarks;
}

export interface Landmarks {
  janNovak: string;
  janBaptism: string;
  janDeath: string;
  janFirstFamily: string;
  janSecondFamily: string;
  kamennaLhota: string;
  dolniKamenec: string;
  vrbice: string;
  horniBukovina: string;
  houseA: string;
  houseB: string;
  parishDolniKamenec: string;
  parishVrbice: string;
  estateVrbice: string;
  event1840: string;
  event1870: string;
  adoptedChild: string;
  adoptedBirthFamily: string;
  adoptedAdoptiveFamily: string;
  oralMarriage: string;
  familyAccountSource: string;
  /** Founding father of the Novák line (generation 1). */
  founder: string;
  /** A generation 6 Person whose pedigree reaches generation 1 (Novák and Horák lines). */
  proband: string;
  bornIn1920: string;
  /** A Person with no birth and no death Event. */
  undated: string;
  pageImage: string;
}

// ---------------------------------------------------------------- deterministic helpers

class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  hex(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(this.next() * 16).toString(16);
    return s;
  }
}

const ID_EPOCH = Date.UTC(2026, 0, 1);

// ---------------------------------------------------------------- invented name stock

interface GivenName {
  cs: string;
  la: string;
  de: string;
}
const g = (cs: string, la: string, de: string): GivenName => ({ cs, la, de });

const MALE: GivenName[] = [
  g('Jan', 'Joannes', 'Johann'),
  g('Václav', 'Wenceslaus', 'Wenzel'),
  g('Tomáš', 'Thomas', 'Thomas'),
  g('Matěj', 'Matthias', 'Matthias'),
  g('Vojtěch', 'Adalbertus', 'Adalbert'),
  g('Antonín', 'Antonius', 'Anton'),
  g('Karel', 'Carolus', 'Karl'),
  g('Martin', 'Martinus', 'Martin'),
  g('Petr', 'Petrus', 'Peter'),
  g('Pavel', 'Paulus', 'Paul'),
  g('Jakub', 'Jacobus', 'Jakob'),
  g('Ondřej', 'Andreas', 'Andreas'),
  g('Prokop', 'Procopius', 'Prokop'),
  g('Šimon', 'Simon', 'Simon'),
  g('Bartoloměj', 'Bartholomaeus', 'Bartholomäus'),
  g('Vincenc', 'Vincentius', 'Vinzenz'),
  g('Jindřich', 'Henricus', 'Heinrich'),
  g('Bohumil', 'Theophilus', 'Gottlieb'),
  g('Vilém', 'Wilhelmus', 'Wilhelm'),
  g('Alois', 'Aloysius', 'Alois'),
];
const FEMALE: GivenName[] = [
  g('Anna', 'Anna', 'Anna'),
  g('Marie', 'Maria', 'Maria'),
  g('Kateřina', 'Catharina', 'Katharina'),
  g('Ludmila', 'Ludmilla', 'Ludmilla'),
  g('Alžběta', 'Elisabetha', 'Elisabeth'),
  g('Magdalena', 'Magdalena', 'Magdalena'),
  g('Barbora', 'Barbara', 'Barbara'),
  g('Dorota', 'Dorothea', 'Dorothea'),
  g('Rozálie', 'Rosalia', 'Rosalia'),
  g('Terezie', 'Theresia', 'Theresia'),
  g('Veronika', 'Veronica', 'Veronika'),
  g('Johana', 'Joanna', 'Johanna'),
  g('Apolena', 'Apollonia', 'Apollonia'),
  g('Markéta', 'Margaretha', 'Margarethe'),
  g('Viktorie', 'Victoria', 'Viktoria'),
  g('Cecílie', 'Caecilia', 'Cäcilie'),
];
const MODERN_MALE = ['Jaroslav', 'Miroslav', 'Zdeněk', 'Bedřich', 'Otakar', 'Rudolf', 'Bohumil', 'Karel'];
const MODERN_FEMALE = ['Božena', 'Věra', 'Jarmila', 'Zdenka', 'Milada', 'Hana', 'Libuše', 'Vlasta', 'Olga', 'Ludmila'];

interface Surname {
  m: string;
  f: string;
  /** The form German and Latin registers wrote. */
  old: string;
  oldF: string;
}
const s = (m: string, f: string, old: string, oldF?: string): Surname => ({ m, f, old, oldF: oldF ?? old });

const SURNAMES: Surname[] = [
  s('Dvořák', 'Dvořáková', 'Dworzak', 'Dworzakowa'),
  s('Černý', 'Černá', 'Czerny', 'Czerna'),
  s('Horák', 'Horáková', 'Horak'),
  s('Němec', 'Němcová', 'Niemetz'),
  s('Marek', 'Marková', 'Marek'),
  s('Pokorný', 'Pokorná', 'Pokorny', 'Pokorna'),
  s('Pospíšil', 'Pospíšilová', 'Pospischil'),
  s('Hájek', 'Hájková', 'Hajek'),
  s('Král', 'Králová', 'Kral'),
  s('Jelínek', 'Jelínková', 'Gelinek'),
  s('Růžička', 'Růžičková', 'Ruziczka'),
  s('Beneš', 'Benešová', 'Benesch'),
  s('Fiala', 'Fialová', 'Fiala'),
  s('Sedláček', 'Sedláčková', 'Sedlaczek'),
  s('Doležal', 'Doležalová', 'Doleschal'),
  s('Zeman', 'Zemanová', 'Zeman'),
  s('Kolář', 'Kolářová', 'Kolarz'),
  s('Navrátil', 'Navrátilová', 'Nawratil'),
  s('Čermák', 'Čermáková', 'Czermak'),
  s('Blažek', 'Blažková', 'Blaschek'),
  s('Kříž', 'Křížová', 'Krzisch'),
  s('Kovář', 'Kovářová', 'Kowarz'),
  s('Bartoš', 'Bartošová', 'Bartosch'),
  s('Vlček', 'Vlčková', 'Wltschek'),
  s('Polák', 'Poláková', 'Polak'),
  s('Musil', 'Musilová', 'Musil'),
  s('Holub', 'Holubová', 'Holub'),
  s('Štěpánek', 'Štěpánková', 'Stiepanek'),
  s('Kadlec', 'Kadlecová', 'Kadletz'),
  s('Hruška', 'Hrušková', 'Hruschka'),
];
const NOVAK = s('Novák', 'Nováková', 'Nowak', 'Nowakowa');
const SVOBODA = s('Svoboda', 'Svobodová', 'Swoboda', 'Swobodowa');
const PROCHAZKA = s('Procházka', 'Procházková', 'Prochaska', 'Prochaskowa');
const VESELY = s('Veselý', 'Veselá', 'Wesely', 'Wesela');
const HORAK = SURNAMES[2]!;

const LATIN_MONTHS = ['Januarii', 'Februarii', 'Martii', 'Aprilis', 'Maii', 'Junii', 'Julii', 'Augusti', 'Septembris', 'Octobris', 'Novembris', 'Decembris'];
const GERMAN_MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const CZECH_MONTHS = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];

// ---------------------------------------------------------------- the builder

interface PersonInfo {
  id: string;
  sex: 'male' | 'female';
  given: GivenName | { cs: string; la: string; de: string };
  surname: Surname;
  generation: number;
  birthYear: number;
  deathYear: number | null;
  home: string | null;
}

interface FamilyInfo {
  id: string;
  husband: PersonInfo;
  wife: PersonInfo;
  home: string;
  generation: number;
  marriedYear: number;
}

type At = { houseId: string } | { placeId: string };

class Builder {
  readonly rng: Rng;
  readonly m: FixtureModel;
  private counter = 0;
  readonly info = new Map<string, PersonInfo>();
  readonly houseInfo = new Map<string, { placeId: string; numbers: Array<{ number: string; from: number | null; to: number | null }> }>();
  readonly placeInfo = new Map<string, { name: string; latin: string; german: string; lat: number; lon: number }>();
  readonly parishPeriods: Array<{ placeId: string; parishId: string; from: number | null; to: number | null }> = [];
  readonly parishName = new Map<string, string>();
  readonly priests: Array<{ parishId: string; from: number; to: number; person: PersonInfo }> = [];
  private readonly sourceCache = new Map<string, string>();

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.m = {
      persons: [],
      names: [],
      families: [],
      childLinks: [],
      places: [],
      placeNames: [],
      houses: [],
      houseNumbers: [],
      parishes: [],
      placeParishes: [],
      estates: [],
      placeEstates: [],
      events: [],
      roles: [],
      sources: [],
      citations: [],
      eventCitations: [],
      nameCitations: [],
      images: [],
      landmarks: {} as Landmarks,
    };
  }

  id(): string {
    const ts = (ID_EPOCH + this.counter++).toString(16).padStart(12, '0');
    const variant = this.rng.pick(['8', '9', 'a', 'b']);
    return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7${this.rng.hex(3)}-${variant}${this.rng.hex(3)}-${this.rng.hex(12)}`;
  }

  day(year: number, month?: number): string {
    const mo = month ?? this.rng.int(1, 12);
    return isoDay(year, mo, this.rng.int(1, daysInMonth(year, mo)));
  }

  // -------------------------------------------------------------- places

  place(name: string, latin: string, german: string, type: PlaceRecord['type'], lat: number, lon: number, code: string): string {
    const id = this.id();
    this.m.places.push({ id, version: 1, type, location: { lat, lon }, municipality: { code, name } });
    this.m.placeNames.push({ id: this.id(), version: 1, placeId: id, name, language: 'cs', primary: true, period: { from: null, to: null } });
    this.m.placeNames.push({ id: this.id(), version: 1, placeId: id, name: german, language: 'de', primary: false, period: { from: null, to: '1918' } });
    this.m.placeNames.push({ id: this.id(), version: 1, placeId: id, name: latin, language: 'la', primary: false, period: { from: null, to: '1850' } });
    this.placeInfo.set(id, { name, latin, german, lat, lon });
    return id;
  }

  house(placeId: string, numbers: Array<{ number: string; from: number | null; to: number | null }>): string {
    const id = this.id();
    const p = this.placeInfo.get(placeId)!;
    const location = { lat: round(p.lat + (this.rng.next() - 0.5) * 0.006), lon: round(p.lon + (this.rng.next() - 0.5) * 0.009) };
    this.m.houses.push({ id, version: 1, placeId, location, note: null });
    for (const n of numbers) {
      this.m.houseNumbers.push({
        id: this.id(),
        version: 1,
        houseId: id,
        number: n.number,
        period: { from: n.from === null ? null : String(n.from), to: n.to === null ? null : String(n.to) },
      });
    }
    this.houseInfo.set(id, { placeId, numbers });
    return id;
  }

  houseNumberAt(houseId: string, year: number): string {
    const h = this.houseInfo.get(houseId)!;
    return h.numbers.find((n) => (n.from === null || n.from <= year) && (n.to === null || year <= n.to))?.number ?? '?';
  }

  placeOf(at: At): string {
    return 'houseId' in at ? this.houseInfo.get(at.houseId)!.placeId : at.placeId;
  }

  parishAt(placeId: string, year: number): string {
    const link = this.parishPeriods.find((l) => l.placeId === placeId && (l.from === null || l.from <= year) && (l.to === null || year <= l.to));
    if (!link) throw new Error(`fixture: no Parish for place ${placeId} in ${year}`);
    return link.parishId;
  }

  parish(name: string, seatPlaceId: string): string {
    const id = this.id();
    this.m.parishes.push({ id, version: 1, name, seatPlaceId });
    this.parishName.set(id, name);
    return id;
  }

  placeParish(placeId: string, parishId: string, from: number | null, to: number | null): void {
    this.m.placeParishes.push({
      id: this.id(),
      version: 1,
      placeId,
      parishId,
      period: { from: from === null ? null : String(from), to: to === null ? null : String(to) },
    });
    this.parishPeriods.push({ placeId, parishId, from, to });
  }

  // -------------------------------------------------------------- persons and families

  person(
    sex: 'male' | 'female',
    given: GivenName,
    surname: Surname,
    generation: number,
    birthYear: number,
    opts: { latin?: boolean; german?: boolean; asFound?: string } = {},
  ): PersonInfo {
    const id = this.id();
    this.m.persons.push({ id, version: 1, sex });
    const sn = sex === 'male' ? surname.m : surname.f;
    this.m.names.push({
      id: this.id(),
      version: 1,
      personId: id,
      given: given.cs,
      surname: sn,
      type: 'birth',
      asFound: opts.asFound ?? `${given.cs} ${sn}`,
      primary: true,
    });
    const oldSurname = sex === 'male' ? surname.old : surname.oldF;
    if (opts.latin)
      this.m.names.push({
        id: this.id(),
        version: 1,
        personId: id,
        given: given.la,
        surname: oldSurname,
        type: 'latin',
        asFound: `${given.la} ${oldSurname}`,
        primary: false,
      });
    if (opts.german)
      this.m.names.push({
        id: this.id(),
        version: 1,
        personId: id,
        given: given.de,
        surname: oldSurname,
        type: 'german',
        asFound: `${given.de} ${oldSurname}`,
        primary: false,
      });
    const p: PersonInfo = { id, sex, given, surname, generation, birthYear, deathYear: null, home: null };
    this.info.set(id, p);
    return p;
  }

  marriedName(wife: PersonInfo, husband: PersonInfo): void {
    this.m.names.push({
      id: this.id(),
      version: 1,
      personId: wife.id,
      given: wife.given.cs,
      surname: husband.surname.f,
      type: 'married',
      asFound: `${wife.given.cs} ${husband.surname.f}`,
      primary: false,
    });
  }

  family(husband: PersonInfo | null, wife: PersonInfo | null): string {
    const id = this.id();
    this.m.families.push({ id, version: 1, partner1Id: husband?.id ?? null, partner2Id: wife?.id ?? null });
    return id;
  }

  childLink(familyId: string, child: PersonInfo, linkType: ChildLinkRecord['linkType'] = 'birth'): void {
    this.m.childLinks.push({ id: this.id(), version: 1, familyId, childId: child.id, linkType });
  }

  // -------------------------------------------------------------- events and evidence

  event(
    type: EventType,
    date: string | null,
    at: At | null,
    roles: Array<[PersonInfo, RoleType, string?]>,
    description: string | null = null,
    typeDetail: string | null = null,
  ): string {
    const id = this.id();
    this.m.events.push({
      id,
      version: 1,
      type,
      typeDetail,
      date,
      placeId: at && 'placeId' in at ? at.placeId : null,
      houseId: at && 'houseId' in at ? at.houseId : null,
      description,
    });
    for (const [p, role, detail] of roles) this.m.roles.push({ id: this.id(), version: 1, eventId: id, personId: p.id, role, roleDetail: detail ?? null });
    return id;
  }

  registerSource(parishId: string, kind: 'N' | 'O' | 'Z', year: number): string {
    const start = year < 1784 ? 1750 : year <= 1830 ? 1784 : year <= 1880 ? 1831 : 1881;
    const end = start === 1750 ? 1783 : start === 1784 ? 1830 : start === 1831 ? 1880 : 1949;
    const key = `${parishId}:${kind}:${start}`;
    const cached = this.sourceCache.get(key);
    if (cached) return cached;
    const id = this.id();
    const what = { N: 'narozených', O: 'oddaných', Z: 'zemřelých' }[kind];
    const parish = this.parishName.get(parishId)!.replace(/^Farnost /, '');
    this.m.sources.push({
      id,
      version: 1,
      type: 'parish_register',
      title: `Matrika ${what} (${kind}) ${parish} ${start}–${end}`,
      repository: 'Invented Regional Archive (fixture)',
      reference: `${parish.slice(0, 3).toUpperCase()} ${kind} ${start - 1700}`,
      url: null,
      familyAccount: null,
      register: { parishId, kinds: [({ N: 'birth', O: 'marriage', Z: 'death' } as const)[kind]], from: start, to: end },
    });
    this.sourceCache.set(key, id);
    return id;
  }

  cite(eventId: string, sourceId: string, page: string | null, transcription: string, confidence: Confidence = 'normal'): string {
    const id = this.id();
    this.m.citations.push({ id, version: 1, sourceId, page, transcription, readOn: this.day(2026, this.rng.int(1, 9)), confidence, note: null });
    this.m.eventCitations.push({ id: this.id(), eventId, citationId: id });
    return id;
  }

  /** Writes the register entry for an Event in the language of its period, and cites it. */
  citeRegister(eventId: string, kind: 'N' | 'O' | 'Z', date: string, at: At, subject: PersonInfo, extra: string): string {
    const year = Number(date.slice(0, 4));
    const placeId = this.placeOf(at);
    const parishId = this.parishAt(placeId, year);
    const sourceId = this.registerSource(parishId, kind, year);
    const month = Number(date.slice(5, 7) || '1');
    const dayText = date.length === 10 ? Number(date.slice(8, 10)) : '';
    const pi = this.placeInfo.get(placeId)!;
    const number = 'houseId' in at ? this.houseNumberAt(at.houseId, year) : null;
    const sn = subject.sex === 'male' ? subject.surname : { ...subject.surname, old: subject.surname.oldF, m: subject.surname.f };
    let text: string;
    if (year <= 1830) {
      const verb = { N: 'baptizatus/a est', O: 'copulati sunt', Z: 'sepultus/a est' }[kind];
      text = `${dayText} ${LATIN_MONTHS[month - 1]} ${year}. ${pi.latin}${number ? ` N° ${number}` : ''}: ${verb} ${subject.given.la} ${sn.old}${extra ? `, ${extra}` : ''}.`;
    } else if (year <= 1880) {
      const verb = { N: 'getauft', O: 'getraut', Z: 'begraben' }[kind];
      text = `${dayText}. ${GERMAN_MONTHS[month - 1]} ${year}, ${pi.german}${number ? ` Nr. ${number}` : ''}: ${subject.given.de} ${sn.old} ${verb}${extra ? `; ${extra}` : ''}.`;
    } else {
      const verb = { N: 'pokřtěn/a', O: 'oddáni', Z: 'pohřben/a' }[kind];
      text = `Dne ${dayText}. ${CZECH_MONTHS[month - 1]} ${year}, ${pi.name}${number ? ` čp. ${number}` : ''}: ${subject.given.cs} ${sn.m} ${verb}${extra ? `; ${extra}` : ''}.`;
    }
    const page = `fol. ${this.rng.int(1, 240)}${this.rng.chance(0.5) ? 'r' : 'v'}`;
    return this.cite(eventId, sourceId, page, text, this.rng.pick<Confidence>(['normal', 'normal', 'high', 'very_high', 'low']));
  }

  priestAt(parishId: string, year: number): PersonInfo | null {
    return this.priests.find((p) => p.parishId === parishId && p.from <= year && year <= p.to)?.person ?? null;
  }

  // -------------------------------------------------------------- life events

  /** Baptism (with birth Event for the 20th century) at the family home. */
  baptise(child: PersonInfo, father: PersonInfo | null, mother: PersonInfo | null, at: At, date: string, godparents: PersonInfo[] = []): string {
    const year = Number(date.slice(0, 4));
    if (year >= 1900) {
      const roles: Array<[PersonInfo, RoleType]> = [[child, 'child']];
      if (father) roles.push([father, 'father']);
      if (mother) roles.push([mother, 'mother']);
      const id = this.event('birth', date, at, roles);
      this.citeRegister(id, 'N', date, at, child, father ? `${father.given.cs} ${father.surname.m}` : '');
      return id;
    }
    const priest = this.priestAt(this.parishAt(this.placeOf(at), year), year);
    const roles: Array<[PersonInfo, RoleType]> = [[child, 'child']];
    if (father) roles.push([father, 'father']);
    if (mother) roles.push([mother, 'mother']);
    for (const gp of godparents) roles.push([gp, 'godparent']);
    if (priest) roles.push([priest, 'priest']);
    const id = this.event('baptism', date, at, roles);
    const parents = [father, mother]
      .filter((p): p is PersonInfo => p !== null)
      .map((p) => (year <= 1830 ? p.given.la : p.given.de))
      .join(' et ');
    this.citeRegister(id, 'N', date, at, child, parents ? `parentes ${parents}` : '');
    return id;
  }

  die(p: PersonInfo, date: string, at: At, informant?: PersonInfo): string {
    p.deathYear = Number(date.slice(0, 4));
    const deathRoles: Array<[PersonInfo, RoleType]> = [[p, 'deceased']];
    if (informant && informant.id !== p.id) deathRoles.push([informant, 'informant']);
    const deathId = this.event('death', date, at, deathRoles);
    const year = p.deathYear;
    const placeId = this.placeOf(at);
    const parishId = this.parishAt(placeId, year);
    const seat = this.m.parishes.find((x) => x.id === parishId)!.seatPlaceId!;
    const burialDate = date.length === 10 ? addDays(date, 2) : date;
    const priest = this.priestAt(parishId, year);
    const burialRoles: Array<[PersonInfo, RoleType]> = [[p, 'deceased']];
    if (priest && priest.id !== p.id) burialRoles.push([priest, 'priest']);
    const burialId = this.event('burial', burialDate, { placeId: seat }, burialRoles);
    if (date.length === 10) this.citeRegister(burialId, 'Z', burialDate, at, p, '');
    return deathId;
  }

  marry(husband: PersonInfo, wife: PersonInfo, date: string, at: At, witnesses: PersonInfo[] = []): string {
    const year = Number(date.slice(0, 4));
    const roles: Array<[PersonInfo, RoleType]> = [
      [husband, 'partner'],
      [wife, 'partner'],
    ];
    for (const w of witnesses) roles.push([w, 'witness']);
    const priest = this.priestAt(this.parishAt(this.placeOf(at), year), year);
    if (priest) roles.push([priest, 'priest']);
    const id = this.event('marriage', date, at, roles);
    this.citeRegister(id, 'O', date, at, husband, `${wife.given.la} ${wife.surname.oldF}`);
    return id;
  }

  census(year: number, houseId: string, people: PersonInfo[]): string {
    const placeId = this.houseInfo.get(houseId)!.placeId;
    const key = `census:${year}:${placeId}`;
    let sourceId = this.sourceCache.get(key);
    if (!sourceId) {
      sourceId = this.id();
      this.m.sources.push({
        id: sourceId,
        version: 1,
        type: 'census',
        title: `Sčítání lidu ${year}, ${this.placeInfo.get(placeId)!.name}`,
        repository: 'Invented District Archive (fixture)',
        reference: `SL ${year}`,
        url: null,
        familyAccount: null,
        register: null,
      });
      this.sourceCache.set(key, sourceId);
    }
    const id = this.event(
      'census',
      `${year}-12-31`,
      { houseId },
      people.map((p) => [p, 'other', 'household member'] as [PersonInfo, RoleType, string]),
    );
    this.cite(
      id,
      sourceId,
      `čp. ${this.houseNumberAt(houseId, year)}`,
      people.map((p) => `${p.given.cs} ${p.sex === 'male' ? p.surname.m : p.surname.f}, ${p.birthYear}`).join('; '),
      'high',
    );
    return id;
  }

  /** Alive in that year; without a recorded death, assume no one lives past 80. */
  alive(p: PersonInfo, year: number): boolean {
    return p.birthYear <= year && (p.deathYear ?? p.birthYear + 80) >= year;
  }
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d + days);
  return isoDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

// ---------------------------------------------------------------- the Tree

export function generateFixture(seed = 267): FixtureModel {
  const b = new Builder(seed);
  const { rng } = b;
  const L = b.m.landmarks;

  // Places: invented names, plausible locations in eastern Bohemia, invented 999xxx municipality codes.
  const kamennaLhota = b.place('Kamenná Lhota', 'Lhota Lapidea', 'Steinlhota', 'village', 49.93, 15.91, '999001');
  const dolniKamenec = b.place('Dolní Kamenec', 'Kamenecium Inferius', 'Unter Kamenetz', 'village', 49.955, 15.87, '999002');
  const vrbice = b.place('Vrbice', 'Wrbicium', 'Wrbitz', 'town', 49.905, 15.985, '999003');
  const zalesi = b.place('Zálesí', 'Zalesium', 'Salesch', 'hamlet', 49.99, 15.95, '999004');
  const horniBukovina = b.place('Horní Bukovina', 'Bukovina Superior', 'Ober Bukowina', 'village', 49.6, 16.3, '999005');
  const lomnice = b.place('Lomnice nad Vrbkou', 'Lomnicium', 'Lomnitz an der Wrbka', 'town', 50.05, 15.78, '999006');
  Object.assign(L, { kamennaLhota, dolniKamenec, vrbice, horniBukovina });

  // Houses. House A: čp. 12 until 1805, čp. 15 afterwards; House B took over čp. 12.
  const houseA = b.house(kamennaLhota, [
    { number: '12', from: null, to: 1805 },
    { number: '15', from: 1806, to: null },
  ]);
  const houseB = b.house(kamennaLhota, [
    { number: '9', from: null, to: 1805 },
    { number: '12', from: 1806, to: null },
  ]);
  const lhotaHouses = [
    houseA,
    houseB,
    b.house(kamennaLhota, [{ number: '3', from: null, to: null }]),
    b.house(kamennaLhota, [
      { number: '7', from: null, to: 1805 },
      { number: '21', from: 1806, to: null },
    ]),
    b.house(kamennaLhota, [{ number: '18', from: 1830, to: null }]),
  ];
  Object.assign(L, { houseA, houseB });
  const kamenecHouses = ['4', '8', '13'].map((n) => b.house(dolniKamenec, [{ number: n, from: null, to: null }]));
  const vrbiceHouses = ['30', '44', '52', '61'].map((n) => b.house(vrbice, [{ number: n, from: null, to: null }]));
  const zalesiHouses = ['2', '5'].map((n) => b.house(zalesi, [{ number: n, from: null, to: null }]));
  const bukovinaHouses = ['10', '11'].map((n) => b.house(horniBukovina, [{ number: n, from: null, to: null }]));
  const lomniceHouses = ['210', '311'].map((n) => b.house(lomnice, [{ number: n, from: 1890, to: null }]));
  const housesByPlace = new Map<string, string[]>([
    [kamennaLhota, lhotaHouses],
    [dolniKamenec, kamenecHouses],
    [vrbice, vrbiceHouses],
    [zalesi, zalesiHouses],
    [horniBukovina, bukovinaHouses],
    [lomnice, lomniceHouses],
  ]);
  const ordinaryPlaces = [kamennaLhota, dolniKamenec, vrbice, zalesi];

  // Parishes, with Kamenná Lhota changing parish after 1857.
  const pKamenec = b.parish('Farnost Dolní Kamenec', dolniKamenec);
  const pVrbice = b.parish('Farnost Vrbice', vrbice);
  const pBukovina = b.parish('Farnost Horní Bukovina', horniBukovina);
  Object.assign(L, { parishDolniKamenec: pKamenec, parishVrbice: pVrbice });
  b.placeParish(kamennaLhota, pKamenec, null, 1857);
  b.placeParish(kamennaLhota, pVrbice, 1858, null);
  b.placeParish(dolniKamenec, pKamenec, null, null);
  b.placeParish(zalesi, pKamenec, null, null);
  b.placeParish(vrbice, pVrbice, null, null);
  b.placeParish(lomnice, pVrbice, null, null);
  b.placeParish(horniBukovina, pBukovina, null, null);

  // Estates until 1848.
  const eVrbice = b.id();
  const eBukovina = b.id();
  b.m.estates.push({ id: eVrbice, version: 1, name: 'Panství Vrbice' }, { id: eBukovina, version: 1, name: 'Panství Bukovina' });
  L.estateVrbice = eVrbice;
  for (const placeId of [kamennaLhota, dolniKamenec, vrbice, zalesi])
    b.m.placeEstates.push({ id: b.id(), version: 1, placeId, estateId: eVrbice, period: { from: null, to: '1848' } });
  b.m.placeEstates.push({ id: b.id(), version: 1, placeId: horniBukovina, estateId: eBukovina, period: { from: null, to: '1848' } });

  // Priests (Persons too). Each gets a burial so that the Living rule sees a recorded death.
  const priestSpecs: Array<[string, GivenName, Surname, number, number]> = [
    [pKamenec, MALE[14]!, SURNAMES[7]!, 1760, 1811],
    [pKamenec, MALE[15]!, SURNAMES[12]!, 1812, 1849],
    [pKamenec, MALE[19]!, SURNAMES[15]!, 1850, 1889],
    [pKamenec, MALE[18]!, SURNAMES[19]!, 1890, 1949],
    [pVrbice, MALE[4]!, SURNAMES[14]!, 1760, 1809],
    [pVrbice, MALE[16]!, SURNAMES[25]!, 1810, 1854],
    [pVrbice, MALE[17]!, SURNAMES[26]!, 1855, 1899],
    [pVrbice, MALE[12]!, SURNAMES[28]!, 1900, 1949],
    [pBukovina, MALE[13]!, SURNAMES[22]!, 1760, 1819],
    [pBukovina, MALE[8]!, SURNAMES[29]!, 1820, 1879],
    [pBukovina, MALE[9]!, SURNAMES[24]!, 1880, 1949],
  ];
  for (const [parishId, given, surname, from, to] of priestSpecs) {
    const priest = b.person('male', given, surname, 0, from - 30, { asFound: `P. ${given.la} ${surname.old}` });
    b.priests.push({ parishId, from, to, person: priest });
  }
  for (const pr of b.priests) {
    const seat = b.m.parishes.find((x) => x.id === pr.parishId)!.seatPlaceId!;
    const year = Math.min(pr.to + 1, 1950);
    pr.person.deathYear = year;
    b.event('burial', String(year), { placeId: seat }, [[pr.person, 'deceased']]);
  }

  const families: FamilyInfo[] = [];
  const pickGiven = (sex: 'male' | 'female', year: number): GivenName => {
    if (year >= 1900) {
      const cs = rng.pick(sex === 'male' ? MODERN_MALE : MODERN_FEMALE);
      return { cs, la: cs, de: cs };
    }
    return rng.pick(sex === 'male' ? MALE : FEMALE);
  };
  const oldForms = (year: number) => ({ latin: year <= 1830 && rng.chance(0.5), german: year > 1830 && year <= 1880 && rng.chance(0.4) });
  const adultsAround = (year: number, placeId: string, exclude: Set<string>) =>
    [...b.info.values()].filter(
      (p) =>
        p.generation > 0 &&
        p.home !== null &&
        b.alive(p, year) &&
        year - p.birthYear >= 18 &&
        !exclude.has(p.id) &&
        b.houseInfo.get(p.home)?.placeId === placeId,
    );

  /** A new Person from outside the Tree (parents unknown), to marry into it. */
  const outsider = (sex: 'male' | 'female', generation: number, birthYear: number, placeId: string): PersonInfo => {
    const p = b.person(sex, pickGiven(sex, birthYear), rng.pick(SURNAMES), generation, birthYear, oldForms(birthYear));
    p.home = rng.pick(housesByPlace.get(placeId)!);
    if (rng.chance(0.6)) b.baptise(p, null, null, { houseId: p.home }, b.day(birthYear));
    return p;
  };

  const endLife = (p: PersonInfo, minAge: number, maxAge: number, informant?: PersonInfo) => {
    const year = p.birthYear + rng.int(minAge, maxAge);
    if (year > 2020 || (p.birthYear >= 1926 && rng.chance(0.75))) return; // still living
    if (year > 1949) {
      // Recorded outside the parish registers we model: a death Event without Citation.
      p.deathYear = year;
      b.event('death', String(year), { houseId: p.home! }, [[p, 'deceased']]);
      return;
    }
    b.die(p, b.day(year), { houseId: p.home! }, informant);
  };

  const census = (fam: FamilyInfo, children: PersonInfo[]) => {
    for (const year of [1869, 1880, 1890, 1900, 1910]) {
      if (year < fam.marriedYear || !b.alive(fam.husband, year)) continue;
      const household = [fam.husband, fam.wife, ...children].filter((p) => b.alive(p, year) && b.houseInfo.has(fam.home));
      if (household.length > 0 && rng.chance(0.8)) b.census(year, fam.home, household);
    }
  };

  /** Children of a Family, and the Families of those who marry, down to generation 6. */
  const grow = (fam: FamilyInfo, count: number, marryChance: number, forced: PersonInfo[] = []) => {
    const childGen = fam.generation + 1;
    const children: PersonInfo[] = [...forced];
    let year = fam.marriedYear + 1;
    for (let i = 0; i < count; i++) {
      year += rng.int(1, 3);
      if (year > 1945 || year - fam.wife.birthYear > 44) break;
      const sex = rng.chance(0.5) ? 'male' : 'female';
      const child = b.person(sex, pickGiven(sex, year), fam.husband.surname, childGen, year, oldForms(year));
      child.home = fam.home;
      b.childLink(fam.id, child);
      const gps = adultsAround(year, b.houseInfo.get(fam.home)!.placeId, new Set([fam.husband.id, fam.wife.id]));
      const godparents = gps.length >= 2 && year < 1900 && rng.chance(0.6) ? [rng.pick(gps), rng.pick(gps)].filter((p, i, a) => a.indexOf(p) === i) : [];
      b.baptise(child, fam.husband, fam.wife, { houseId: fam.home }, b.day(year), godparents);
      children.push(child);
      if (rng.chance(year < 1880 ? 0.22 : 0.05)) {
        b.die(child, b.day(year + rng.int(0, 4)), { houseId: fam.home });
        continue;
      }
      if (childGen < 6 && rng.chance(marryChance)) {
        const spousePlace = rng.pick(ordinaryPlaces);
        const spouse = outsider(sex === 'male' ? 'female' : 'male', childGen, year + rng.int(-4, 4), spousePlace);
        const husband = sex === 'male' ? child : spouse;
        const wife = sex === 'male' ? spouse : child;
        const married = Math.max(husband.birthYear, wife.birthYear) + rng.int(20, 27);
        if (married > 1945) continue;
        const home = sex === 'male' ? (rng.chance(0.5) ? fam.home : rng.pick(housesByPlace.get(spousePlace)!)) : spouse.home!;
        const famId = b.family(husband, wife);
        b.marriedName(wife, husband);
        b.marry(husband, wife, b.day(married), { houseId: wife.home! });
        husband.home = home;
        wife.home = home;
        const next: FamilyInfo = { id: famId, husband, wife, home, generation: childGen, marriedYear: married };
        families.push(next);
        grow(next, rng.int(2, childGen >= 4 ? 3 : 4), childGen >= 4 ? 0.35 : 0.4);
        endLife(husband, 45, 80, wife);
        endLife(wife, 45, 85);
      } else if (childGen === 6 || rng.chance(0.3)) {
        endLife(child, 40, 85);
      }
    }
    census(fam, children);
  };

  // ---------------------------------------------------------------- generation 1: founding couples

  const founder = (husbandGiven: GivenName, surname: Surname, wifeGiven: GivenName, wifeSurname: Surname, year: number, home: string) => {
    const h = b.person('male', husbandGiven, surname, 1, year, { latin: true });
    const w = b.person('female', wifeGiven, wifeSurname, 1, year + rng.int(2, 6), { latin: true });
    h.home = home;
    w.home = home;
    const famId = b.family(h, w);
    b.marriedName(w, h);
    const married = year + rng.int(22, 26);
    b.marry(h, w, b.day(married), { houseId: home });
    const fam: FamilyInfo = { id: famId, husband: h, wife: w, home, generation: 1, marriedYear: married };
    families.push(fam);
    return fam;
  };

  // The Novák line at House A of Kamenná Lhota. Founding father's birth is known only as "about 1745".
  const vaclav = b.person('male', MALE[1]!, NOVAK, 1, 1745, { latin: true });
  const anna = b.person('female', FEMALE[0]!, SURNAMES[0]!, 1, 1750, { latin: true });
  vaclav.home = houseA;
  anna.home = houseA;
  L.founder = vaclav.id;
  b.event('birth', '1745~', { placeId: kamennaLhota }, [[vaclav, 'child']], 'Year derived from his age at burial');
  b.event('birth', '1749/1751', null, [[anna, 'child']], 'Between 1749 and 1751, from the 1771 marriage entry');
  const fNovak1 = b.family(vaclav, anna);
  b.marriedName(anna, vaclav);
  b.marry(vaclav, anna, '1771-02-05', { houseId: houseA });
  b.die(vaclav, '1805-02-11', { houseId: houseA });
  // Her death is known only as "before 1805": he was a widower at his burial.
  anna.deathYear = 1804;
  b.event('death', '../1805', { placeId: kamennaLhota }, [[anna, 'deceased']], 'Recorded as widower at his burial');
  const famNovak1: FamilyInfo = { id: fNovak1, husband: vaclav, wife: anna, home: houseA, generation: 1, marriedYear: 1771 };
  families.push(famNovak1);

  const famSvoboda1 = founder(MALE[3]!, SVOBODA, FEMALE[2]!, SURNAMES[1]!, 1744, kamenecHouses[0]!);
  const famProchazka1 = founder(MALE[5]!, PROCHAZKA, FEMALE[4]!, SURNAMES[3]!, 1750, vrbiceHouses[1]!);
  const famVesely1 = founder(MALE[6]!, VESELY, FEMALE[9]!, SURNAMES[5]!, 1752, zalesiHouses[0]!);
  const famHorak1 = founder(MALE[7]!, HORAK, FEMALE[6]!, SURNAMES[8]!, 1748, bukovinaHouses[0]!);
  for (const f of [famSvoboda1, famProchazka1, famVesely1, famHorak1]) {
    b.baptise(f.husband, null, null, { houseId: f.home }, b.day(f.husband.birthYear));
  }

  // ---------------------------------------------------------------- generation 2

  const child = (fam: FamilyInfo, sex: 'male' | 'female', given: GivenName, date: string, godparents: PersonInfo[] = []): PersonInfo => {
    const year = Number(date.slice(0, 4));
    const p = b.person(sex, given, fam.husband.surname, fam.generation + 1, year, oldForms(year));
    p.home = fam.home;
    b.childLink(fam.id, p);
    b.baptise(p, fam.husband, fam.wife, { houseId: fam.home }, date, godparents);
    return p;
  };
  const wed = (husband: PersonInfo, wife: PersonInfo, date: string, home: string, witnesses: PersonInfo[] = []): FamilyInfo => {
    const famId = b.family(husband, wife);
    b.marriedName(wife, husband);
    b.marry(husband, wife, date, { houseId: wife.home ?? home }, witnesses);
    husband.home = home;
    wife.home = home;
    const fam: FamilyInfo = {
      id: famId,
      husband,
      wife,
      home,
      generation: Math.max(husband.generation, wife.generation),
      marriedYear: Number(date.slice(0, 4)),
    };
    families.push(fam);
    return fam;
  };

  const tomas = child(famNovak1, 'male', MALE[2]!, '1772-12-21');
  const marieSvobodova = child(famSvoboda1, 'female', FEMALE[1]!, '1776-08-15');
  const rozalieSvobodova = child(famSvoboda1, 'female', FEMALE[8]!, '1779-09-02');
  const matejHorak = child(famHorak1, 'male', MALE[3]!, '1775-02-24');
  const prochazka2 = child(famProchazka1, 'male', MALE[10]!, '1778-07-25');
  const vesely2 = child(famVesely1, 'male', MALE[0]!, '1781-06-24');
  const famNovak2 = wed(tomas, marieSvobodova, '1798-01-23', houseA);
  const prochazkaWife = outsider('female', 2, 1781, vrbice);
  const famProchazka2 = wed(prochazka2, prochazkaWife, '1802-11-09', vrbiceHouses[1]!);
  const veselyWife = outsider('female', 2, 1784, zalesi);
  const famVesely2 = wed(vesely2, veselyWife, '1806-05-13', zalesiHouses[0]!);
  matejHorak.home = bukovinaHouses[0]!;
  rozalieSvobodova.home = kamenecHouses[0]!;

  // ---------------------------------------------------------------- generation 3: Jan Novák

  // Baptism at House A, then čp. 12: child, father, mother, two godparents and the priest.
  const jan = b.person('male', MALE[0]!, NOVAK, 3, 1801, { latin: true, german: true });
  jan.home = houseA;
  L.janNovak = jan.id;
  b.childLink(famNovak2.id, jan);
  L.janBaptism = b.baptise(jan, tomas, marieSvobodova, { houseId: houseA }, '1801-03-12', [matejHorak, rozalieSvobodova]);
  const latinName = b.m.names.find((n) => n.personId === jan.id && n.type === 'latin')!;
  b.m.nameCitations.push({ id: b.id(), nameId: latinName.id, citationId: b.m.eventCitations.find((c) => c.eventId === L.janBaptism)!.citationId });

  const katerina = child(famProchazka2, 'female', FEMALE[2]!, '1804-04-29');
  const ludmila = child(famVesely2, 'female', FEMALE[3]!, '1812-09-16');

  // First marriage; Kateřina dies in 1835. Second marriage in 1837. Each Family keeps its children.
  const famJan1 = wed(jan, katerina, '1825-11-22', houseA);
  L.janFirstFamily = famJan1.id;
  const karel = child(famJan1, 'male', MALE[6]!, '1827-01-28');
  child(famJan1, 'female', FEMALE[1]!, '1829-07-02');
  child(famJan1, 'male', MALE[4]!, '1832-04-23');
  b.die(katerina, '1835-03-02', { houseId: houseA }, jan);
  const famJan2 = wed(jan, ludmila, '1837-02-07', houseA);
  L.janSecondFamily = famJan2.id;
  // 1840 at House A (čp. 15): Kamenná Lhota is still in the Parish of Dolní Kamenec.
  const antonin = b.person('male', MALE[5]!, NOVAK, 4, 1840, { german: true });
  antonin.home = houseA;
  b.childLink(famJan2.id, antonin);
  L.event1840 = b.baptise(antonin, jan, ludmila, { houseId: houseA }, '1840-05-02', [rozalieSvobodova]);
  child(famJan2, 'female', FEMALE[10]!, '1843-01-19');
  child(famJan2, 'male', MALE[9]!, '1846-06-29');
  // 1850 at the same House, now čp. 15.
  L.janDeath = b.die(jan, '1850-11-03', { houseId: houseA }, ludmila);
  b.die(ludmila, '1871-03-15', { houseId: houseA });
  b.die(tomas, '1831-10-06', { houseId: houseA });
  b.die(marieSvobodova, '1839-01-12', { houseId: houseA });

  // ---------------------------------------------------------------- generation 4 and 5: the adoption

  // Antonín marries in 1866; a child baptised in 1870 at House A falls under the Parish of Vrbice.
  const antoninWife = outsider('female', 4, 1845, dolniKamenec);
  const famAntonin = wed(antonin, antoninWife, '1866-02-13', houseA);
  const bohumil = b.person('male', MALE[17]!, NOVAK, 5, 1870);
  bohumil.home = houseA;
  b.childLink(famAntonin.id, bohumil);
  L.event1870 = b.baptise(bohumil, antonin, antoninWife, { houseId: houseA }, '1870-08-28');
  child(famAntonin, 'female', FEMALE[12]!, '1873-04-09');

  // Karel (Jan's son from the first marriage) and his wife die young; their daughter Marie (1885)
  // is adopted by Karel's half-brother Antonín. She keeps her birth Family link.
  const karelWife = outsider('female', 4, 1858, vrbice);
  karel.home = lhotaHouses[2]!;
  const famKarel = wed(karel, karelWife, '1882-10-24', lhotaHouses[2]!);
  const adopted = b.person('female', FEMALE[1]!, NOVAK, 5, 1885);
  adopted.home = lhotaHouses[2]!;
  b.childLink(famKarel.id, adopted, 'birth');
  b.baptise(adopted, karel, karelWife, { houseId: lhotaHouses[2]! }, '1885-12-08');
  b.die(karelWife, '1886-02-17', { houseId: lhotaHouses[2]! });
  b.die(karel, '1887-09-30', { houseId: lhotaHouses[2]! });
  b.childLink(famAntonin.id, adopted, 'adoptive');
  adopted.home = houseA;
  Object.assign(L, { adoptedChild: adopted.id, adoptedBirthFamily: famKarel.id, adoptedAdoptiveFamily: famAntonin.id });
  b.die(antonin, '1912-01-04', { houseId: houseA }, bohumil);
  b.die(antoninWife, '1915-05-21', { houseId: houseA });

  // ---------------------------------------------------------------- generations 5 and 6: the proband line

  // Bohumil (1870) marries a great-granddaughter of the Horák founders, so the proband's pedigree
  // reaches generation 1 through both parents.
  const horak2Wife = outsider('female', 2, 1778, horniBukovina);
  matejHorak.home = bukovinaHouses[1]!;
  const famHorak2 = wed(matejHorak, horak2Wife, '1800-01-14', bukovinaHouses[1]!);
  const horak3 = child(famHorak2, 'male', MALE[11]!, '1803-11-30');
  const horak3Wife = outsider('female', 3, 1806, horniBukovina);
  const famHorak3 = wed(horak3, horak3Wife, '1828-02-05', bukovinaHouses[1]!);
  // 1845 Event in Horní Bukovina, outside the main map area.
  const horak4 = child(famHorak3, 'female', FEMALE[13]!, '1845-10-15');
  const horak4Husband = outsider('male', 4, 1842, vrbice);
  const famHorak4 = wed(horak4Husband, horak4, '1866-11-20', vrbiceHouses[2]!);
  const bohumilWife = child(famHorak4, 'female', FEMALE[5]!, '1874-07-22');
  const famBohumil = wed(bohumil, bohumilWife, '1896-01-28', houseA);
  const g6Father = b.person('male', MALE[0]!, NOVAK, 6, 1899);
  g6Father.home = houseA;
  b.childLink(famBohumil.id, g6Father);
  b.baptise(g6Father, bohumil, bohumilWife, { houseId: houseA }, '1899-04-03');
  // Generation 6: the proband, born 1902 at House A, died 1975.
  const proband = b.person('female', FEMALE[7]!, NOVAK, 6, 1902);
  proband.home = houseA;
  b.childLink(famBohumil.id, proband);
  b.baptise(proband, bohumil, bohumilWife, { houseId: houseA }, '1902-02-06');
  proband.deathYear = 1975;
  b.event('death', '1975-03-30', { houseId: houseA }, [[proband, 'deceased']]);
  L.proband = proband.id;
  census(famBohumil, [g6Father, proband]);

  // A Person born 1920 with no recorded death: not Living in 2026.
  const in1920 = b.person('male', { cs: 'Zdeněk', la: 'Zdeněk', de: 'Zdeněk' }, NOVAK, 6, 1920);
  in1920.home = lomniceHouses[0]!;
  b.childLink(famBohumil.id, in1920);
  b.event('birth', '1920-06-11', { houseId: lomniceHouses[0]! }, [
    [in1920, 'child'],
    [bohumil, 'father'],
    [bohumilWife, 'mother'],
  ]);
  L.bornIn1920 = in1920.id;
  b.die(bohumil, '1938-12-01', { houseId: houseA });

  // ---------------------------------------------------------------- the rest of the Tree

  grow(famNovak1, 2, 0.3);
  grow(famSvoboda1, 3, 0.5);
  grow(famProchazka1, 2, 0.4);
  grow(famVesely1, 2, 0.4);
  grow(famHorak1, 2, 0.3);
  grow(famNovak2, 2, 0.3);
  grow(famProchazka2, 2, 0.4);
  grow(famVesely2, 2, 0.4);
  grow(famJan1, 1, 0.3);
  grow(famJan2, 2, 0.4);
  grow(famAntonin, 2, 0.5);
  grow(famHorak2, 1, 0.3);
  grow(famHorak3, 2, 0.3);
  grow(famBohumil, 2, 0.0);

  // Oral history: a marriage known only from a Family account given in 2026 by a Living relative.
  // Her father is a generation 5 man of the Tree, so she is generation 6.
  const ludmilaFather =
    [...b.info.values()].find(
      (p) => p.generation === 5 && p.sex === 'male' && p.birthYear >= 1895 && p.birthYear <= 1910 && p.home !== null && p.deathYear === null,
    ) ??
    (() => {
      const extra = b.person('male', { cs: 'Jaroslav', la: 'Jaroslaus', de: 'Jaroslaw' }, NOVAK, 5, 1903);
      extra.home = houseA;
      b.childLink(famAntonin.id, extra);
      return extra;
    })();
  const ludmilaMother = outsider('female', 5, ludmilaFather.birthYear + 2, vrbice);
  const famOral = b.family(ludmilaFather, ludmilaMother);
  b.marriedName(ludmilaMother, ludmilaFather);
  const ludmilaG6 = b.person('female', { cs: 'Ludmila', la: 'Ludmilla', de: 'Ludmilla' }, ludmilaFather.surname, 6, 1941);
  ludmilaG6.home = lomniceHouses[1]!;
  b.childLink(famOral, ludmilaG6);
  b.event('birth', '1941-05-09', { houseId: lomniceHouses[1]! }, [
    [ludmilaG6, 'child'],
    [ludmilaFather, 'father'],
    [ludmilaMother, 'mother'],
  ]);
  // Her brothers: one born 1933 who died in 2001, one born 1936 and Living.
  for (const [given, date, died] of [
    ['Miroslav', '1933-02-14', '2001-07-19'],
    ['Jaroslav', '1936-10-02', null],
  ] as const) {
    const brother = b.person('male', { cs: given, la: given, de: given }, ludmilaFather.surname, 6, Number(date.slice(0, 4)));
    brother.home = lomniceHouses[1]!;
    b.childLink(famOral, brother);
    b.event('birth', date, { houseId: lomniceHouses[1]! }, [
      [brother, 'child'],
      [ludmilaFather, 'father'],
      [ludmilaMother, 'mother'],
    ]);
    if (died) {
      brother.deathYear = 2001;
      b.event('death', died, { placeId: lomnice }, [[brother, 'deceased']]);
    }
  }
  const accountId = b.id();
  b.m.sources.push({
    id: accountId,
    version: 1,
    type: 'family_account',
    title: 'What Ludmila recalled about her parents (invented)',
    repository: null,
    reference: null,
    url: null,
    familyAccount: { givenBy: `Ludmila ${ludmilaFather.surname.f} (invented)`, givenByPersonId: ludmilaG6.id, givenOn: '2026-05-01' },
    register: null,
  });
  L.familyAccountSource = accountId;
  L.oralMarriage = b.event('marriage', '1931~', { placeId: lomnice }, [
    [ludmilaFather, 'partner'],
    [ludmilaMother, 'partner'],
  ]);
  b.cite(L.oralMarriage, accountId, null, 'They married in Lomnice "the summer the river flooded", around 1931; she did not know the exact date.', 'low');

  // A Person with no dates at all: Living by the rule.
  const undated = b.person('male', { cs: 'Bedřich', la: 'Fridericus', de: 'Friedrich' }, NOVAK, 6, 1930);
  undated.home = lomniceHouses[0]!;
  b.childLink(famOral, undated);
  L.undated = undated.id;

  // Everyone born before 1926 gets a recorded death, except the deliberate Living cases.
  const keepLiving = new Set([in1920.id, ludmilaG6.id, undated.id]);
  for (const p of b.info.values()) {
    if (p.generation === 0 || p.deathYear !== null || keepLiving.has(p.id) || p.home === null) continue;
    endLife(p, 50, 85);
  }

  // ---------------------------------------------------------------- images (metadata only)

  const baptismCitation = b.m.eventCitations.find((c) => c.eventId === L.janBaptism)!.citationId;
  L.pageImage = b.id();
  b.m.images.push({
    id: L.pageImage,
    version: 1,
    kind: 'page',
    citationId: baptismCitation,
    personIds: [],
    contentType: 'image/jpeg',
    byteSize: 2_481_337,
    width: 3024,
    height: 4032,
    sha256: 'b'.repeat(64),
    caption: 'Register page, baptism of Jan Novák (fixture)',
    storageKey: 'fixtures/page-jan-novak-1801.jpg',
  });
  b.m.images.push({
    id: b.id(),
    version: 1,
    kind: 'portrait',
    citationId: null,
    personIds: [proband.id],
    contentType: 'image/webp',
    byteSize: 312_004,
    width: 1600,
    height: 2000,
    sha256: 'c'.repeat(64),
    caption: 'Portrait (fixture)',
    storageKey: 'fixtures/portrait-proband.webp',
  });

  return b.m;
}
