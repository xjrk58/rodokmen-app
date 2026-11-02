import { IsoDay, WebUrl, type Confidence } from '@rodokmen/shared';
import { childLink, ensureFamily, ensurePerson, eventDate, eventWhere, factEvent, factsOf, marriageEvent, marriagesOf, parentsOf, role } from './map-people.js';
import { linked, unmapped, vaultCitation, type MapContext } from './map-places.js';
import { at, CONFIDENCE_OF, lowest, type PlannedFile, type PlannedProposal } from './plan.js';
import { dateText, linkOf, textOf, type VaultNote } from './reader.js';

/**
 * Source notes (vault-import spec, "One Proposal per Source note"): one Proposal each, in date
 * order, with the Citation, its scans and documents, and everything the entry supports. Then one
 * Proposal per Person for what no Source note covers.
 */
const KNOWN = ['type', 'accessed', 'url', 'date', 'register', 'scans', 'frame', 'page', 'kind', 'aliases'];
const OWN_SOURCE: Record<string, 'family_account' | 'other'> = {
  'family-document': 'family_account',
  'family-memory': 'family_account',
  gravestone: 'other',
  web: 'other',
};
const IMAGE_TYPES: Record<string, PlannedFile['type']> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Who cites a Source note, and with what. */
export interface Citers {
  facts: Array<{ person: VaultNote; fact: ReturnType<typeof factsOf>[number] }>;
  marriages: Array<{ person: VaultNote; marriage: ReturnType<typeof marriagesOf>[number] }>;
}

/** Which Person notes cite each Source note, by its id. */
export function citersOf(ctx: MapContext): Map<string, Citers> {
  const out = new Map<string, Citers>();
  const of = (id: string) => out.get(id) ?? out.set(id, { facts: [], marriages: [] }).get(id)!;
  for (const person of ctx.vault.notes.filter((n) => n.folder === 'people')) {
    for (const fact of factsOf(person)) {
      const s = linkOf(fact.source);
      if (s && ctx.vault.byId.get(s)?.folder === 'sources') of(ctx.vault.byId.get(s)!.id).facts.push({ person, fact });
    }
    for (const marriage of marriagesOf(person)) {
      const s = linkOf(marriage.source);
      if (s && ctx.vault.byId.get(s)?.folder === 'sources') of(ctx.vault.byId.get(s)!.id).marriages.push({ person, marriage });
    }
  }
  return out;
}

/** The confidence of a Source note's Citation: the lowest its Persons give; a disagreement is reported. */
function confidenceOf(ctx: MapContext, note: VaultNote, citers: Citers | undefined): Confidence {
  const values = [...new Set([...(citers?.facts ?? []), ...(citers?.marriages ?? [])].map((c) => CONFIDENCE_OF[String(c.person.data.confidence)] ?? 'normal'))];
  if (values.length > 1) ctx.b.report('confidenceDisagreement', note.path, values.join(', '));
  return values.reduce<Confidence>((a, v) => lowest(a, v), values[0] ?? 'normal');
}

/** The first heading of a note's body, as a title. */
const headingOf = (note: VaultNote) => /^#{1,3} +(.+)$/m.exec(note.body)?.[1]?.trim() ?? null;

function files(ctx: MapContext, p: PlannedProposal, note: VaultNote, citationKey: string, sourceKey: string, paged: boolean): void {
  const scans = Array.isArray(note.data.scans) ? note.data.scans.filter((s): s is string => typeof s === 'string') : [];
  for (const path of scans) {
    if (!ctx.vault.files.has(path)) {
      ctx.b.report('missingFile', note.path, path);
      continue;
    }
    const ext = path.split('.').at(-1)!.toLowerCase();
    const name = path.split('/').at(-1)!;
    if (IMAGE_TYPES[ext]) {
      p.files.push({ path, type: IMAGE_TYPES[ext] });
      ctx.b.link(p, `image:${path}`, 'image', { op: 'addImage', uploadId: at(`upload:${path}`), kind: paged ? 'page' : 'photo', citationId: at(citationKey) });
    } else if (ext === 'pdf') {
      p.files.push({ path, type: 'application/pdf' });
      ctx.b.link(p, `document:${path}`, 'document', { op: 'addDocument', sourceId: at(sourceKey), uploadId: at(`upload:${path}`), title: name });
    } else if (ext === 'doc') {
      // Converted to PDF once, with LibreOffice on the Owner's machine; the original DOC is kept beside it.
      p.files.push({ path, type: 'application/msword', convertedKey: `upload:${path}.pdf` });
      ctx.b.link(p, `document:${path}`, 'document', {
        op: 'addDocument',
        sourceId: at(sourceKey),
        uploadId: at(`upload:${path}.pdf`),
        originalUploadId: at(`upload:${path}`),
        title: name,
      });
    } else {
      ctx.b.report('skippedFile', note.path, `${path}: not an image, PDF or DOC`);
    }
  }
}

/** Where in its register the entry is: its page, else its frame. */
function citationPage(note: VaultNote): string | null {
  const page = textOf(note.data.page).trim();
  const frame = textOf(note.data.frame).trim();
  return (page || (frame ? `frame ${frame}` : '')).slice(0, 200) || null;
}

/** A Source of its own for a Source note outside the registers: a family document or memory, a gravestone, a web page. */
function ownSource(ctx: MapContext, p: PlannedProposal, note: VaultNote, accessed: string | null): string {
  const kind = textOf(note.data.kind) || 'other';
  if (!OWN_SOURCE[kind]) ctx.b.report('unmappedValue', note.path, `sources.kind: ${kind}`);
  const type = OWN_SOURCE[kind] ?? 'other';
  const url = WebUrl.safeParse(note.data.url);
  const key = `source:${note.id}`;
  ctx.b.create(p, key, 'source', {
    op: 'createSource',
    tempId: '',
    type,
    title: (headingOf(note) ?? note.id).slice(0, 400),
    url: url.success ? url.data : null,
    familyAccount:
      type === 'family_account'
        ? { givenBy: 'not recorded in the Vault', givenByPersonId: null, givenOn: dateText(note.data.date) ?? accessed ?? ctx.readOn }
        : null,
  });
  if (note.body.trim()) ctx.b.link(p, `notes:${key}`, 'notes', { op: 'setNotes', record: 'source', id: at(key), notes: note.body });
  return key;
}

/** The Citation of a Source note: of its register, or of a Source of its own (family documents and memories, gravestones, web pages). */
function citation(ctx: MapContext, p: PlannedProposal, note: VaultNote, confidence: Confidence): string {
  const key = `citation:${note.id}`;
  const register = linkOf(note.data.register) ? linked(ctx, note, note.data.register, 'registers', 'register') : null;
  const accessed = dateText(note.data.accessed);
  const url = WebUrl.safeParse(note.data.url);
  const sourceKey = register ? `register:${register.id}` : ownSource(ctx, p, note, accessed);
  ctx.b.create(p, key, 'citation', {
    op: 'createCitation',
    tempId: '',
    sourceId: at(sourceKey),
    page: citationPage(note),
    // The note's body is the transcription of the entry (vault-import spec, "Note bodies become research notes").
    transcription: (note.body.trim() || note.frontmatterText.trim() || note.path).slice(0, 20_000),
    readOn: accessed && IsoDay.safeParse(accessed).success ? accessed : ctx.readOn,
    confidence,
    note: [`Vault: ${note.path}`, url.success && register ? `Scan: ${url.data}` : null].filter(Boolean).join('\n'),
  });
  files(ctx, p, note, key, sourceKey, register !== null);
  return key;
}

/** The sort key of a Source note: its date (undated last), then its id. */
const dateKey = (note: VaultNote) => `${dateText(note.data.date) ?? '9999'}|${note.id}`;

/** One Proposal per Source note, in date order, so that a Person is created by the earliest entry that names them. */
export function mapSources(ctx: MapContext, citers: Map<string, Citers>): void {
  const notes = ctx.vault.notes.filter((n) => n.folder === 'sources').sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
  for (const note of notes) {
    const who = citers.get(note.id);
    const p = ctx.b.proposal('source', `source-note:${note.id}`, `Vault: ${note.path}`, note);
    const citationKey = citation(ctx, p, note, confidenceOf(ctx, note, who));
    for (const { person, fact } of who?.facts ?? []) factEvent(ctx, p, person, fact, citationKey);
    for (const { person, marriage } of who?.marriages ?? []) marriageEvent(ctx, p, person, marriage, citationKey, note.id);
    unmapped(ctx, note, KNOWN);
  }
}

/** Whether a fact or marriage cites a Source note that exists. */
const sourced = (ctx: MapContext, source: unknown) => {
  const s = linkOf(source);
  return s !== null && ctx.vault.byId.get(s)?.folder === 'sources';
};

/** A residence: the Person lived at a House or Place, in a period. */
function residence(ctx: MapContext, p: PlannedProposal, note: VaultNote, r: Record<string, unknown>, i: number, citationKey: string, person: string): void {
  const from = dateText(r.from);
  const to = dateText(r.to);
  const raw = from || to ? `${from ?? '..'}/${to ?? '..'}` : null;
  const single = from !== null && to === null ? from : null;
  const key = `event:${note.id}:residence:${i}`;
  const { date, description } = eventDate(ctx, note, single ?? (raw === '../..' ? null : raw), `residences.${i}`);
  ctx.b.create(p, key, 'event', {
    op: 'createEvent',
    tempId: '',
    type: 'residence',
    date,
    ...eventWhere(ctx, note, r.place, r.house, `residences.${i}`),
    description,
  });
  role(ctx, p, key, person, 'other', typeof r.role === 'string' ? r.role.slice(0, 200) : null);
  ctx.b.link(p, `cite:${key}:${citationKey}`, 'citation link', { op: 'attachCitation', citationId: at(citationKey), eventId: at(key) });
}

/**
 * One Proposal per Person for what no Source note covers (design, "Proposal order"): the Person
 * when no entry named them, facts and marriages without a Source note, residences and Family
 * links, each citing the Vault provenance Source with the note's path and low confidence.
 */
export function mapPersons(ctx: MapContext): void {
  const { b } = ctx;
  for (const note of ctx.vault.notes.filter((n) => n.folder === 'people')) {
    const facts = factsOf(note).filter((f) => !sourced(ctx, f.source));
    const marriages = marriagesOf(note).filter((m) => !sourced(ctx, m.source));
    const residences = (Array.isArray(note.data.residences) ? note.data.residences : []).filter(
      (r): r is Record<string, unknown> => !!r && typeof r === 'object',
    );
    const p = b.proposal('person', `person-note:${note.id}`, `Vault: ${note.path}`, note);
    const before = p.ops.length;
    const person = ensurePerson(ctx, p, note);
    const { father, mother, adoptiveFather, adoptiveMother } = parentsOf(ctx, p, note);
    if (father || mother) childLink(ctx, p, ensureFamily(ctx, p, father, mother), person, 'birth');
    if (adoptiveFather || adoptiveMother) childLink(ctx, p, ensureFamily(ctx, p, adoptiveFather, adoptiveMother), person, 'adoptive');
    if (facts.length || marriages.length || residences.length || p.ops.length > before) {
      const citationKey = vaultCitation(ctx, p, note);
      for (const f of facts) factEvent(ctx, p, note, f, citationKey);
      for (const m of marriages) marriageEvent(ctx, p, note, m, citationKey, null);
      residences.forEach((r, i) => residence(ctx, p, note, r, i, citationKey, person));
    }
    if (p.ops.length === before) b.proposals.pop();
  }
}
