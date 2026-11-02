import { foldForSearch, HouseNumber, WebUrl } from '@rodokmen/shared';
import { at, type PlanBuilder, type PlannedProposal } from './plan.js';
import { isRecord, linkOf, textOf, type Vault, type VaultNote } from './reader.js';

/**
 * Places, Parishes, Houses and registers (design, "Mapping"): each note its own Proposal, submitted
 * first, citing the Vault provenance Source with the note's path (vault-import spec, "Every
 * imported fact has provenance").
 */

/** A Municipality of the Czech lands (app/data/municipalities.json). */
export interface Municipality {
  code: string;
  name: string;
  district: string;
  lat: number;
  lon: number;
}

export interface MapContext {
  b: PlanBuilder;
  vault: Vault;
  municipalities: Municipality[];
  /** The day the Vault's notes are cited as read: the commit's date. */
  readOn: string;
  /** The seat Place of each Parish note, as a plan key, for Events the Vault puts at a Parish (its church). */
  parishSeats: Map<string, string>;
}

const PLACE_TYPES: Record<string, 'village' | 'town' | 'hamlet' | 'other'> = {
  obec: 'village',
  vesnice: 'village',
  město: 'town',
  mesto: 'town',
  osada: 'hamlet',
};
const KNOWN = {
  place: ['type', 'name', 'kind', 'district', 'lat', 'lon', 'names', 'aliases'],
  parish: ['type', 'name', 'seat', 'aliases'],
  house: ['type', 'place', 'numbers', 'aliases'],
  register: ['type', 'archive', 'signature', 'kind', 'years', 'places', 'url', 'parish', 'aliases'],
};
const KINDS: Record<string, 'birth' | 'marriage' | 'death'> = { N: 'birth', O: 'marriage', Z: 'death' };

/** Fields of a note the Tree has no place for, reported by name. */
export function unmapped(ctx: MapContext, note: VaultNote, known: readonly string[]): void {
  for (const field of Object.keys(note.data)) if (!known.includes(field)) ctx.b.report('unmappedField', note.path, `${note.folder}.${field}`);
}

/** The Citation of the Vault provenance Source that a record without its own Source note cites. */
export function vaultCitation(ctx: MapContext, p: PlannedProposal, note: VaultNote): string {
  const key = `vault-citation:${note.path}`;
  ctx.b.create(p, key, 'citation', {
    op: 'createCitation',
    tempId: '',
    sourceId: at('vault-source'),
    page: note.path,
    transcription: note.frontmatterText.trim() || note.path,
    readOn: ctx.readOn,
    confidence: 'low',
    note: null,
  });
  return key;
}

/** Research notes from the note's body, unchanged (vault-import spec, "Note bodies become research notes"). */
export function notesOf(ctx: MapContext, p: PlannedProposal, record: string, recordKey: string, note: VaultNote): void {
  if (note.body.trim() === '') return;
  ctx.b.link(p, `notes:${recordKey}`, 'notes', { op: 'setNotes', record, id: at(recordKey), notes: note.body });
}

/** The Vault note a link points to, in a folder; a missing one is reported. */
export function linked(ctx: MapContext, from: VaultNote, value: unknown, folder: VaultNote['folder'], field: string): VaultNote | null {
  const id = linkOf(value);
  if (id === null) return null;
  const target = ctx.vault.byId.get(id);
  if (!target || target.folder !== folder) {
    ctx.b.report('brokenLink', from.path, `${field}: [[${id}]]`);
    return null;
  }
  return target;
}

const fold = (s: unknown) => (typeof s === 'string' ? foldForSearch(s) : '');

function municipalityOf(ctx: MapContext, note: VaultNote) {
  const name = fold(note.data.name);
  const district = fold(note.data.district);
  if (!name || !district) return null;
  return ctx.municipalities.find((m) => fold(m.name) === name && fold(m.district) === district) ?? null;
}

/** A Place's kind, as the Tree's type; a kind it has no type for is reported. */
function placeType(ctx: MapContext, note: VaultNote) {
  const kind = textOf(note.data.kind);
  const type = PLACE_TYPES[foldForSearch(kind)];
  if (kind && !type) ctx.b.report('unmappedValue', note.path, `places.kind: ${kind}`);
  return type ?? 'other';
}

/** A Place's point: its own, else its Municipality's when it is the Municipality's namesake. */
function placeLocation(note: VaultNote, name: string, m: Municipality | null) {
  const { lat, lon } = note.data;
  if (typeof lat === 'number' && typeof lon === 'number') return { lat, lon };
  return m && fold(m.name) === fold(name) ? { lat: m.lat, lon: m.lon } : null;
}

/** Other names of a Place, in Czech (the old name), German or Latin. */
function placeNames(ctx: MapContext, p: PlannedProposal, note: VaultNote, key: string): void {
  const names = isRecord(note.data.names) ? note.data.names : {};
  for (const [lang, value] of Object.entries(names)) {
    const language = lang === 'de' ? 'de' : lang === 'la' ? 'la' : lang === 'old' || lang === 'cs' ? 'cs' : null;
    if (typeof value !== 'string' || value.trim() === '' || language === null) {
      ctx.b.report('unmappedValue', note.path, `places.names.${lang}`);
      continue;
    }
    ctx.b.link(p, `place-name:${note.id}:${lang}`, 'place name', { op: 'addPlaceName', placeId: at(key), name: value.trim(), language });
  }
}

function mapPlace(ctx: MapContext, note: VaultNote): void {
  const { b } = ctx;
  const name = textOf(note.data.name).trim() || note.id;
  const m = municipalityOf(ctx, note);
  if (!m && note.data.district) b.report('unmappedValue', note.path, 'places.district: no Municipality of that name in that district');
  const p = b.proposal('place', `place-note:${note.id}`, `Vault: ${note.path}`, note);
  vaultCitation(ctx, p, note);
  const key = `place:${note.id}`;
  b.create(p, key, 'place', {
    op: 'createPlace',
    tempId: '',
    type: placeType(ctx, note),
    location: placeLocation(note, name, m),
    municipality: m ? { code: m.code, name: m.name } : null,
    name: { name, language: 'cs' },
  });
  placeNames(ctx, p, note, key);
  notesOf(ctx, p, 'place', key, note);
  unmapped(ctx, note, KNOWN.place);
}

function mapParish(ctx: MapContext, note: VaultNote, places: VaultNote[]): void {
  const { b } = ctx;
  const p = b.proposal('parish', `parish-note:${note.id}`, `Vault: ${note.path}`, note);
  vaultCitation(ctx, p, note);
  const seatText = typeof note.data.seat === 'string' ? note.data.seat.trim() : '';
  const seat = linked(ctx, note, seatText, 'places', 'seat') ?? places.find((pl) => fold(pl.data.name) === fold(seatText) && fold(seatText) !== '') ?? null;
  let seatKey = seat ? `place:${seat.id}` : null;
  if (!seat && seatText && !/\[\[/.test(seatText)) {
    // The Vault names the seat but has no note for it: the Place is created from the Parish note, linked to its Municipality when only one has that name.
    const matches = ctx.municipalities.filter((m) => fold(m.name) === fold(seatText));
    const m = matches.length === 1 ? matches[0]! : null;
    seatKey = `place:seat:${note.id}`;
    b.create(p, seatKey, 'place', {
      op: 'createPlace',
      tempId: '',
      type: 'other',
      location: m ? { lat: m.lat, lon: m.lon } : null,
      municipality: m ? { code: m.code, name: m.name } : null,
      name: { name: seatText.slice(0, 200), language: 'cs' },
    });
    b.report('unmappedValue', note.path, 'parishes.seat: no Place note; a Place is created from the seat');
  }
  if (seatKey) ctx.parishSeats.set(note.id, seatKey);
  const name = typeof note.data.name === 'string' && note.data.name.trim() ? note.data.name.trim() : note.id;
  b.create(p, `parish:${note.id}`, 'parish', { op: 'createParish', tempId: '', name, seatPlaceId: seatKey ? at(seatKey) : null });
  notesOf(ctx, p, 'parish', `parish:${note.id}`, note);
  unmapped(ctx, note, KNOWN.parish);
}

function mapHouse(ctx: MapContext, note: VaultNote): void {
  const { b } = ctx;
  const place = linked(ctx, note, note.data.place, 'places', 'place');
  if (!place) {
    b.report('unmappedValue', note.path, 'houses.place: no Place, the House is not imported');
    return;
  }
  const raw: unknown[] = Array.isArray(note.data.numbers) ? note.data.numbers : [];
  const numbers = raw.flatMap((n) => {
    const number = textOf(isRecord(n) ? n.number : n)
      .trim()
      .toLowerCase();
    if (!HouseNumber.safeParse(number).success) {
      b.report('unmappedValue', note.path, 'houses.numbers: not a house number');
      return [];
    }
    return [{ number }];
  });
  const p = b.proposal('house', `house-note:${note.id}`, `Vault: ${note.path}`, note);
  vaultCitation(ctx, p, note);
  b.create(p, `house:${note.id}`, 'house', { op: 'createHouse', tempId: '', placeId: at(`place:${place.id}`), numbers });
  notesOf(ctx, p, 'house', `house:${note.id}`, note);
  unmapped(ctx, note, KNOWN.house);
}

/** The years a register covers, from 1784/1820, 1784-05/1820-12, 1784/.. or 1784. */
export function registerYears(value: unknown): { from: number | null; to: number | null } | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const m = /^(\d{4})(?:-\d{2}(?:-\d{2})?)?(?:\/(\d{4}|\.\.)(?:-\d{2}(?:-\d{2})?)?)?$/.exec(text);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : m[2] === '..' ? null : Number(m[2]);
  return to !== null && to < from ? null : { from, to };
}

/** A register's kinds: the Tree's (births, marriages, deaths), and whether it is a census. */
function registerKinds(ctx: MapContext, note: VaultNote) {
  const raw: unknown[] = Array.isArray(note.data.kind) ? note.data.kind : [note.data.kind];
  const kinds = raw.filter((k): k is string => typeof k === 'string');
  for (const k of kinds) if (!KINDS[k] && k !== 'census' && k !== 'I') ctx.b.report('unmappedValue', note.path, `registers.kind: ${k}`);
  return { kinds, census: kinds.includes('census'), coverage: [...new Set(kinds.flatMap((k) => (KINDS[k] ? [KINDS[k]] : [])))] };
}

/** A register's title, as the Vault names registers: kinds, Places and years. */
function registerTitle(note: VaultNote, kinds: string[], placesText: string, years: { from: number | null; to: number | null } | null) {
  const yearsText = years ? (years.to === years.from ? `${years.from}` : `${years.from}–${years.to ?? '…'}`) : '';
  return ([kinds.join(', '), placesText, yearsText].filter(Boolean).join(' ') || note.id).slice(0, 400);
}

/** The Places a register names belonged to its Parish in its years. */
function registerPlaces(
  ctx: MapContext,
  p: PlannedProposal,
  note: VaultNote,
  places: VaultNote[],
  parish: VaultNote,
  years: { from: number | null; to: number | null } | null,
) {
  for (const part of textOf(note.data.places).split(/[,;]| a /)) {
    const place = places.find((pl) => fold(pl.data.name) === fold(part.trim()) && part.trim() !== '');
    if (!place) continue;
    ctx.b.link(p, `place-parish:${place.id}:${parish.id}:${note.id}`, 'Place in a Parish', {
      op: 'linkPlaceParish',
      placeId: at(`place:${place.id}`),
      parishId: at(`parish:${parish.id}`),
      period: { from: years?.from ? String(years.from) : null, to: years?.to ? String(years.to) : null },
    });
  }
}

function mapRegister(ctx: MapContext, note: VaultNote, places: VaultNote[]): void {
  const { b } = ctx;
  const { kinds, census, coverage } = registerKinds(ctx, note);
  const years = registerYears(note.data.years);
  if (note.data.years !== undefined && !years) b.report('badDate', note.path, `registers.years: ${JSON.stringify(note.data.years)}`);
  const parish = linked(ctx, note, note.data.parish, 'parishes', 'parish');
  const url = WebUrl.safeParse(note.data.url);
  if (note.data.url !== undefined && !url.success) b.report('unmappedValue', note.path, 'registers.url: not a web link');
  const p = b.proposal('register', `register-note:${note.id}`, `Vault: ${note.path}`, note);
  vaultCitation(ctx, p, note);
  const key = `register:${note.id}`;
  const signature = textOf(note.data.signature).trim();
  b.create(p, key, 'source', {
    op: 'createSource',
    tempId: '',
    type: census ? 'census' : 'parish_register',
    title: registerTitle(note, kinds, textOf(note.data.places).trim(), years),
    repository: textOf(note.data.archive).trim() || null,
    reference: signature ? signature.slice(0, 200) : null,
    url: url.success ? url.data : null,
    register:
      parish && !census && coverage.length ? { parishId: at(`parish:${parish.id}`), kinds: coverage, from: years?.from ?? null, to: years?.to ?? null } : null,
  });
  if (parish && !census) registerPlaces(ctx, p, note, places, parish, years);
  notesOf(ctx, p, 'source', key, note);
  unmapped(ctx, note, KNOWN.register);
}

/** Places first, then Parishes, Houses and registers, each note its own Proposal. */
export function mapPlaces(ctx: MapContext): void {
  const byFolder = (f: VaultNote['folder']) => ctx.vault.notes.filter((n) => n.folder === f);
  const places = byFolder('places');
  for (const n of places) mapPlace(ctx, n);
  for (const n of byFolder('parishes')) mapParish(ctx, n, places);
  for (const n of byFolder('houses')) mapHouse(ctx, n);
  for (const n of byFolder('registers')) mapRegister(ctx, n, places);
}
