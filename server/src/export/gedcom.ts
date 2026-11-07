import { createHash } from 'node:crypto';
import type { ExportCitation, ExportEvent, ExportRecord } from '@rodokmen/shared';
import type { ExportTree } from './gather.js';

/**
 * The GEDCOM 5.5.1 Export (exports spec, "Nightly Export to rodokmen-export", "GEDCOM download
 * for the Owner"): lineage-linked, UTF-8. It writes only the Export view (shared/src/export.ts),
 * the same as the Markdown Export, so a Living person is `NAME`, `SEX`, `BIRT DATE <year>` and
 * their `FAMC`/`FAMS`, and nothing else ("Living grandchild in GEDCOM"), and no record has an
 * image (no `OBJE`).
 *
 * Cross-reference ids come from the record ids, so they stay the same from night to night, and
 * the header has no date: the same Tree always gives the same file, the nightly one and the
 * Owner's download alike.
 */

const MAX_LINE = 255;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A cross-reference id: a letter and the last 16 hex digits of the record id (random in UUIDv7). */
export function xref(letter: 'I' | 'F' | 'S' | 'R', id: string): string {
  return `@${letter}${id.replace(/-/g, '').slice(-16).toUpperCase()}@`;
}

function repoXref(name: string): string {
  return `@R${createHash('sha256').update(name).digest('hex').slice(0, 16).toUpperCase()}@`;
}

/** A date part of EDTF (YYYY, YYYY-MM or YYYY-MM-DD) as GEDCOM: `1801`, `FEB 1801`, `6 FEB 1801`. */
function simpleDate(part: string): string | null {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(part);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (mo === undefined) return y!;
  const month = MONTHS[Number(mo) - 1];
  if (month === undefined) return null;
  return d === undefined ? `${month} ${y}` : `${Number(d)} ${month} ${y}`;
}

/**
 * An EDTF date of the Tree as a GEDCOM date: about (`~`) is `ABT`, uncertain (`?`) is `EST`, a
 * range is `BET … AND …`, open ranges are `BEF` and `AFT`. Null when it cannot be said.
 */
export function gedcomDate(edtf: string): string | null {
  if (edtf.includes('/')) {
    const [from = '', to = ''] = edtf.split('/');
    if (from === '..') return to === '..' ? null : prefixed('BEF', simpleDate(to));
    if (to === '..') return prefixed('AFT', simpleDate(from));
    const a = simpleDate(from);
    const b = simpleDate(to);
    return a && b ? `BET ${a} AND ${b}` : null;
  }
  if (edtf.endsWith('~')) return prefixed('ABT', simpleDate(edtf.slice(0, -1)));
  if (edtf.endsWith('?')) return prefixed('EST', simpleDate(edtf.slice(0, -1)));
  return simpleDate(edtf);
}

const prefixed = (word: string, date: string | null) => (date === null ? null : `${word} ${date}`);

/** GEDCOM lines for a value: `@` doubled, line breaks as CONT, long lines split with CONC. */
function lines(level: number, tag: string, value: string): string[] {
  const text = value.replace(/\r\n?/g, '\n').replace(/@/g, '@@');
  const out: string[] = [];
  text.split('\n').forEach((part, i) => {
    let rest = part;
    let first = true;
    const lead = i === 0 ? `${level} ${tag}` : `${level + 1} CONT`;
    do {
      const prefix = first ? lead : `${level + 1} CONC`;
      const room = MAX_LINE - prefix.length - 1;
      let cut = Math.min(rest.length, room);
      // Never split a surrogate pair, and avoid starting the continuation with a space.
      while (cut < rest.length && cut > 1 && (/[\udc00-\udfff]/.test(rest[cut]!) || rest[cut] === ' ')) cut--;
      const chunk = rest.slice(0, cut);
      out.push(chunk ? `${prefix} ${chunk}` : prefix);
      rest = rest.slice(cut);
      first = false;
    } while (rest.length > 0);
  });
  return out;
}

const QUAY: Record<string, string> = { very_low: '0', low: '1', normal: '2', high: '3', very_high: '3' };

function citation(level: number, c: ExportCitation): string[] {
  const out = [`${level} SOUR ${xref('S', c.sourceId)}`];
  if (c.page) out.push(...lines(level + 1, 'PAGE', c.page));
  out.push(`${level + 1} QUAY ${QUAY[c.confidence] ?? '2'}`);
  if (c.transcription) out.push(`${level + 1} DATA`, ...lines(level + 2, 'TEXT', c.transcription));
  if (c.note) out.push(...lines(level + 1, 'NOTE', c.note));
  return out;
}

interface Places {
  name(id: string): string | undefined;
  location(id: string): { lat: number; lon: number } | undefined;
  /** A House's Place and its number at the time of the Event (the latest known). */
  house(id: string): { placeId: string; number: string } | undefined;
}

function eventDetail(e: ExportEvent, places: Places): string[] {
  const out: string[] = [];
  if (e.type === 'other' && e.typeDetail) out.push(...lines(2, 'TYPE', e.typeDetail));
  const date = e.date ? gedcomDate(e.date) : null;
  if (date) out.push(`2 DATE ${date}`);
  else if (e.date) out.push(...lines(2, 'NOTE', `Date: ${e.date}`));
  const house = e.houseId ? places.house(e.houseId) : undefined;
  const placeId = e.placeId || house?.placeId;
  const placeName = placeId ? places.name(placeId) : undefined;
  if (placeId && placeName) {
    out.push(...lines(2, 'PLAC', placeName));
    const loc = places.location(placeId);
    if (loc) out.push('3 MAP', `4 LATI ${loc.lat >= 0 ? 'N' : 'S'}${Math.abs(loc.lat)}`, `4 LONG ${loc.lon >= 0 ? 'E' : 'W'}${Math.abs(loc.lon)}`);
  }
  if (house?.number) out.push(...lines(2, 'ADDR', `čp. ${house.number}${placeName ? `, ${placeName}` : ''}`), ...lines(3, 'ADR1', `čp. ${house.number}`));
  if (e.description) out.push(...lines(2, 'NOTE', e.description));
  if (e.notes) out.push(...lines(2, 'NOTE', e.notes));
  for (const c of e.citations) out.push(...citation(2, c));
  return out;
}

/** The GEDCOM tag of an Event in the record of a Person with this Role, or null when it is someone else's. */
function individualTag(e: ExportEvent, role: string): string | null {
  if (e.type === 'birth' && role === 'child') return 'BIRT';
  if (e.type === 'baptism' && role === 'child') return 'CHR';
  if (e.type === 'death' && role === 'deceased') return 'DEAT';
  if (e.type === 'burial' && role === 'deceased') return 'BURI';
  if (e.type === 'residence') return 'RESI';
  if (e.type === 'census') return 'CENS';
  if (e.type === 'other' && role !== 'priest' && role !== 'witness' && role !== 'informant') return 'EVEN';
  return null;
}

const NAME_TYPES: Record<string, string> = { birth: 'birth', married: 'married', nickname: 'aka', latin: 'aka', german: 'aka', other: 'aka' };
const PEDI: Record<string, string> = { birth: 'birth', adoptive: 'adopted', foster: 'foster' };

function individual(r: ExportRecord, places: Places, exported: ReadonlySet<string>): string[] {
  const out = [`0 ${xref('I', r.id)} INDI`];
  r.names.forEach((n, i) => {
    out.push(...lines(1, 'NAME', `${n.given} /${n.surname.replace(/\//g, ' ')}/`.trim()));
    if (n.given) out.push(...lines(2, 'GIVN', n.given));
    if (n.surname) out.push(...lines(2, 'SURN', n.surname));
    if (i > 0 && NAME_TYPES[n.type]) out.push(`2 TYPE ${NAME_TYPES[n.type]}`);
    for (const c of n.citations) out.push(...citation(2, c));
  });
  out.push(`1 SEX ${r.sex === 'male' ? 'M' : r.sex === 'female' ? 'F' : 'U'}`);
  if (r.living) {
    // The reduction keeps the birth year and nothing else of the birth.
    if (r.hasBirthYear) out.push('1 BIRT', `2 DATE ${r.birthYear}`);
  } else {
    for (const e of r.events) {
      const role = e.roles.find((x) => x.personId === r.id)?.role ?? '';
      const tag = individualTag(e, role);
      if (tag === null) continue;
      out.push(`1 ${tag}`, ...eventDetail(e, places));
      // A residence, census or other Event can name several people: say which part this one had.
      if ((tag === 'RESI' || tag === 'CENS' || tag === 'EVEN') && role && role !== 'other') out.push(...lines(2, 'NOTE', `Role: ${role}`));
    }
    // Godparents, witnesses and priests of their baptism, birth, death or burial.
    for (const e of r.events) {
      const principal = e.roles.some((x) => x.personId === r.id && individualTag(e, x.role) !== null && (x.role === 'child' || x.role === 'deceased'));
      if (!principal) continue;
      for (const a of e.roles)
        if ((a.role === 'godparent' || a.role === 'witness' || a.role === 'priest') && a.personId !== r.id && exported.has(a.personId))
          out.push(`1 ASSO ${xref('I', a.personId)}`, ...lines(2, 'RELA', `${a.role} (${e.type})`));
    }
  }
  for (const rel of r.relations) {
    if (rel.rel === 'childOf') {
      out.push(`1 FAMC ${xref('F', rel.target)}`);
      if (PEDI[rel.detail]) out.push(`2 PEDI ${PEDI[rel.detail]}`);
    } else if (rel.rel === 'partnerIn') out.push(`1 FAMS ${xref('F', rel.target)}`);
  }
  if (r.notes) out.push(...lines(1, 'NOTE', r.notes));
  return out;
}

function family(r: ExportRecord, sexOf: ReadonlyMap<string, string>, places: Places): string[] {
  const out = [`0 ${xref('F', r.id)} FAM`];
  const partners = r.relations.filter((x) => x.rel === 'partner').map((x) => x.target);
  const [p1, p2] = partners;
  // GEDCOM 5.5.1 knows HUSB and WIFE only: by sex where known, else in the Tree's order.
  const swap = p1 !== undefined && (sexOf.get(p1) === 'female' || (p2 !== undefined && sexOf.get(p2) === 'male' && sexOf.get(p1) !== 'male'));
  const [husb, wife] = swap ? [p2, p1] : [p1, p2];
  if (husb) out.push(`1 HUSB ${xref('I', husb)}`);
  if (wife) out.push(`1 WIFE ${xref('I', wife)}`);
  for (const c of r.relations.filter((x) => x.rel === 'child')) out.push(`1 CHIL ${xref('I', c.target)}`);
  for (const e of r.events) out.push('1 MARR', ...eventDetail(e, places));
  if (r.notes) out.push(...lines(1, 'NOTE', r.notes));
  return out;
}

function source(r: ExportRecord): string[] {
  const fact = (key: string) => r.facts.find((f) => f.key === key)?.value;
  const out = [`0 ${xref('S', r.id)} SOUR`, ...lines(1, 'TITL', fact('title') ?? '?')];
  const givenBy = fact('givenBy');
  if (givenBy) out.push(...lines(1, 'AUTH', givenBy));
  const givenOn = fact('givenOn');
  if (givenOn) out.push(...lines(1, 'PUBL', `Given on ${givenOn}`));
  const repository = fact('repository');
  if (repository) {
    out.push(`1 REPO ${repoXref(repository)}`);
    const reference = fact('reference');
    if (reference) out.push(...lines(2, 'CALN', reference));
  }
  const notes = [
    ...r.links.map((l) => `${l.label}: ${l.target}`),
    ...(fact('registerKinds') ? [`Register: ${fact('registerKinds')} ${fact('registerYears') ?? ''}`.trim()] : []),
    ...(r.notes ? [r.notes] : []),
  ];
  if (notes.length) out.push(...lines(1, 'NOTE', notes.join('\n')));
  return out;
}

/** The GEDCOM file of the Export view of the Tree. */
export function gedcomFile(tree: ExportTree): string {
  const byKind = (kind: string) => tree.records.filter((r) => r.kind === kind);
  const persons = byKind('person');
  const exported = new Set(persons.map((p) => p.id));
  const sexOf = new Map(persons.map((p) => [p.id, p.sex]));
  const placeRecords = new Map(byKind('place').map((p) => [p.id, p]));
  const houseRecords = new Map(byKind('house').map((h) => [h.id, h]));
  const places: Places = {
    name: (id) => tree.titles.get(id),
    location(id) {
      const loc = placeRecords.get(id)?.facts.find((f) => f.key === 'location')?.value;
      if (!loc) return undefined;
      const [lat = NaN, lon = NaN] = loc.split(',').map(Number);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
    },
    house(id) {
      const h = houseRecords.get(id);
      const placeId = h?.relations.find((x) => x.rel === 'place')?.target;
      if (!h || !placeId) return undefined;
      const numbers = h.facts.filter((f) => f.key === 'number');
      return { placeId, number: numbers[numbers.length - 1]?.value ?? '' };
    },
  };
  const sources = byKind('source');
  const repositories = [...new Set(sources.map((s) => s.facts.find((f) => f.key === 'repository')?.value).filter((x): x is string => !!x))].sort();
  const out = [
    '0 HEAD',
    '1 SOUR RODOKMEN',
    '2 NAME Rodokmen',
    '1 SUBM @SUBM@',
    '1 GEDC',
    '2 VERS 5.5.1',
    '2 FORM LINEAGE-LINKED',
    '1 CHAR UTF-8',
    '0 @SUBM@ SUBM',
    '1 NAME Rodokmen',
  ];
  for (const p of persons) out.push(...individual(p, places, exported));
  for (const f of byKind('family')) out.push(...family(f, sexOf, places));
  for (const s of sources) out.push(...source(s));
  for (const name of repositories) out.push(`0 ${repoXref(name)} REPO`, ...lines(1, 'NAME', name));
  out.push('0 TRLR');
  return `${out.join('\n')}\n`;
}
