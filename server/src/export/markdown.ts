import type { ExportCitation, ExportEvent, ExportRecord, LeadView } from '@rodokmen/shared';
import { stringify } from 'yaml';
import type { ExportTree, RecordKind } from './gather.js';

/**
 * The Markdown Export (exports spec, "Nightly Export to rodokmen-export"; design, "Export
 * layout"): one note per Person, Family, Place, House, Parish, Estate and Source in `people/`,
 * `families/`, `places/`, `houses/`, `parishes/`, `estates/` and `sources/`, and one per Research
 * lead in `leads/`. Each note has YAML frontmatter, with the field names of the API, and
 * `[[slug|title]]` links to the others, so the folder opens as an Obsidian vault. It writes only
 * the Export view (shared/src/export.ts): what a Living person keeps, and no image.
 *
 * The output depends on the Tree alone (no date of the run), so a night without changes writes
 * the same bytes and the Export makes no commit.
 */

export const FOLDERS: Record<RecordKind | 'lead', string> = {
  person: 'people',
  family: 'families',
  place: 'places',
  house: 'houses',
  parish: 'parishes',
  estate: 'estates',
  source: 'sources',
  lead: 'leads',
};

const README = `# Rodokmen Export

A one-way copy of the family Tree, written every night by the Rodokmen server. Do not edit it:
the Tree is the source of truth, and the next Export overwrites any change made here. Changes go
through Proposals in Rodokmen.

- One Markdown note per record in \`people/\`, \`families/\`, \`places/\`, \`houses/\`, \`parishes/\`,
  \`estates/\` and \`sources/\`, and per Research lead in \`leads/\`, linked with \`[[…]]\`. The
  folder opens as an Obsidian vault.
- \`family.ged\`: the same Tree as GEDCOM 5.5.1, for other genealogy programs.
- Living people keep only their name, sex, relationships and birth year. Events they took part
  in are left out, and so are notes of Families they belong to.
- No images or documents: page images, portraits and PDFs stay on the server.
`;

const EVENT_TITLES: Record<string, string> = {
  birth: 'Birth',
  baptism: 'Baptism',
  marriage: 'Marriage',
  death: 'Death',
  burial: 'Burial',
  residence: 'Residence',
  census: 'Census',
  other: 'Event',
};

interface Ctx {
  slugs: ReadonlyMap<string, string>;
  titles: ReadonlyMap<string, string>;
}

/** A link to another note, or the plain title when that record is not in the Export. */
function link(ctx: Ctx, id: string, fallback = '?'): string {
  const slug = ctx.slugs.get(id);
  const title = (ctx.titles.get(id) ?? fallback).replace(/[[\]|]/g, ' ').trim() || fallback;
  return slug ? `[[${slug}|${title}]]` : title;
}

function frontmatter(data: Record<string, unknown>): string {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)));
  return `---\n${stringify(clean, { lineWidth: 0 })}---\n`;
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n');
}

function citationLines(ctx: Ctx, c: ExportCitation, indent: string): string[] {
  const head = [`${indent}- Source: ${link(ctx, c.sourceId)}`, c.page ? `, page ${c.page}` : '', `, confidence ${c.confidence.replace('_', ' ')}`].join('');
  const out = [head];
  if (c.transcription) out.push(quote(c.transcription).replace(/^/gm, `${indent}  `));
  if (c.note) out.push(`${indent}  Note: ${c.note}`);
  return out;
}

function eventLines(ctx: Ctx, e: ExportEvent, self?: string): string[] {
  const where = [e.placeId ? link(ctx, e.placeId) : '', e.houseId ? link(ctx, e.houseId) : ''].filter(Boolean).join(', ');
  const title = e.type === 'other' && e.typeDetail ? e.typeDetail : (EVENT_TITLES[e.type] ?? e.type);
  const out = [`### ${title}${e.date ? ` ${e.date}` : ''}`, ''];
  if (where) out.push(`Where: ${where}`, '');
  const roles = e.roles.filter((r) => r.personId !== self || e.roles.length > 1);
  if (roles.length) {
    for (const r of roles) out.push(`- ${r.role}: ${link(ctx, r.personId)}`);
    out.push('');
  }
  if (e.description) out.push(e.description, '');
  if (e.citations.length) {
    for (const c of e.citations) out.push(...citationLines(ctx, c, ''));
    out.push('');
  }
  if (e.notes) out.push(e.notes, '');
  return out;
}

function section(title: string, lines: string[]): string[] {
  return lines.length ? [`## ${title}`, '', ...lines, ...(lines[lines.length - 1] === '' ? [] : [''])] : [];
}

function personNote(ctx: Ctx, r: ExportRecord): string {
  const primary = r.names[0];
  const name = primary ? `${primary.given} ${primary.surname}`.trim() : '?';
  const facts = (key: string) => r.facts.filter((f) => f.key === key).map((f) => f.value);
  const head = frontmatter({
    id: r.id,
    type: 'person',
    name,
    aliases: [...new Set(r.names.map((n) => `${n.given} ${n.surname}`.trim()))],
    sex: r.sex,
    living: r.living,
    birthYear: r.hasBirthYear ? r.birthYear : undefined,
    relation: facts('relation')[0],
    familyRoot: facts('familyRoot').length ? true : undefined,
    labels: facts('label'),
  });
  const body = [`# ${name}`, ''];
  if (r.living) body.push('Living: only the name, sex, relationships and birth year are in the Export.', '');
  body.push(
    ...section(
      'Names',
      r.names.length > 1 || (primary && (primary.asFound || primary.citations.length))
        ? r.names.flatMap((n) => [
            `- ${`${n.given} ${n.surname}`.trim()}${n.type ? ` (${n.type}${n.language ? `, ${n.language}` : ''})` : ''}${n.asFound ? `, as found: ${n.asFound}` : ''}`,
            ...n.citations.flatMap((c) => citationLines(ctx, c, '  ')),
          ])
        : [],
    ),
  );
  body.push(
    ...section(
      'Families',
      r.relations.map((rel) =>
        rel.rel === 'childOf'
          ? `- Child of ${link(ctx, rel.target)}${rel.detail && rel.detail !== 'birth' ? ` (${rel.detail})` : ''}`
          : `- Partner in ${link(ctx, rel.target)}`,
      ),
    ),
  );
  body.push(
    ...section(
      'Events',
      r.events.flatMap((e) => eventLines(ctx, e, r.id)),
    ),
  );
  body.push(...section('Notes', r.notes ? [r.notes] : []));
  return `${head}\n${body.join('\n').trimEnd()}\n`;
}

function familyNote(ctx: Ctx, r: ExportRecord): string {
  const title = ctx.titles.get(r.id) ?? 'Family';
  const head = frontmatter({
    id: r.id,
    type: 'family',
    partners: r.relations.filter((x) => x.rel === 'partner').map((x) => ctx.slugs.get(x.target) ?? x.target),
    children: r.relations.filter((x) => x.rel === 'child').map((x) => ctx.slugs.get(x.target) ?? x.target),
  });
  const body = [`# ${title}`, ''];
  body.push(
    ...section(
      'Partners',
      r.relations.filter((x) => x.rel === 'partner').map((x) => `- ${link(ctx, x.target)}`),
    ),
  );
  body.push(
    ...section(
      'Children',
      r.relations.filter((x) => x.rel === 'child').map((x) => `- ${link(ctx, x.target)}${x.detail && x.detail !== 'birth' ? ` (${x.detail})` : ''}`),
    ),
  );
  body.push(
    ...section(
      'Events',
      r.events.flatMap((e) => eventLines(ctx, e)),
    ),
  );
  body.push(...section('Notes', r.notes ? [r.notes] : []));
  return `${head}\n${body.join('\n').trimEnd()}\n`;
}

const REL_TITLES: Record<string, string> = {
  parish: 'Parishes',
  estate: 'Estates',
  house: 'Houses',
  place: 'Places',
  seat: 'Seat',
  givenBy: 'Given by',
};

function genericNote(ctx: Ctx, r: ExportRecord): string {
  const title = ctx.titles.get(r.id) ?? r.kind;
  const withDetail = (f: { value: string; detail: string }) => (f.detail ? `${f.value} (${f.detail})` : f.value);
  // A Place has names over time, a House numbers over time: lists. Every other fact is one value.
  const listed = (key: string) => r.facts.filter((f) => f.key === key && (key !== 'name' || r.kind === 'place'));
  const scalar: Record<string, unknown> = { id: r.id, type: r.kind };
  for (const f of r.facts) if (f.key !== 'number' && !(f.key === 'name' && r.kind === 'place')) scalar[f.key] = withDetail(f);
  const head = frontmatter({ ...scalar, names: listed('name').map(withDetail), numbers: listed('number').map(withDetail) });
  const body = [`# ${title}`, ''];
  body.push(
    ...section(
      'Names',
      listed('name').map((f) => `- ${withDetail(f)}`),
    ),
  );
  body.push(
    ...section(
      'House numbers',
      listed('number').map((f) => `- ${withDetail(f)}`),
    ),
  );
  const rels = [...new Set(r.relations.map((x) => x.rel))];
  for (const rel of rels)
    body.push(
      ...section(
        REL_TITLES[rel] ?? rel,
        r.relations.filter((x) => x.rel === rel).map((x) => `- ${link(ctx, x.target)}${x.detail ? ` (${x.detail})` : ''}`),
      ),
    );
  body.push(
    ...section(
      'Links',
      r.links.map((l) => `- [${l.label || l.target}](${l.target})`),
    ),
  );
  body.push(...section('Notes', r.notes ? [r.notes] : []));
  return `${head}\n${body.join('\n').trimEnd()}\n`;
}

function leadNote(ctx: Ctx, l: LeadView): string {
  const head = frontmatter({
    id: l.id,
    type: 'lead',
    status: l.status,
    archive: l.archive ?? undefined,
    source: l.source ? (ctx.slugs.get(l.source.id) ?? l.source.title) : undefined,
    years: l.years ? `${l.years.from}–${l.years.to}` : undefined,
    pages: l.pages ?? undefined,
    persons: l.persons.map((p) => ctx.slugs.get(p.id) ?? p.id),
    places: l.places.map((p) => ctx.slugs.get(p.id) ?? p.id),
  });
  const body = [`# ${l.question}`, '', l.reason, ''];
  if (l.outcome) body.push(...section('Outcome', [l.outcome]));
  if (l.source) body.push(...section('Where to look', [`- ${link(ctx, l.source.id, l.source.title)}`]));
  body.push(
    ...section(
      'Persons',
      l.persons.map((p) => `- ${link(ctx, p.id, p.displayName)}`),
    ),
  );
  body.push(
    ...section(
      'Places',
      l.places.map((p) => `- ${link(ctx, p.id, p.name)}`),
    ),
  );
  body.push(
    ...section(
      'Searches',
      [...l.searches]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map(
          (s) =>
            `- ${s.searchedOn}, ${s.searchedBy}: ${s.source ? link(ctx, s.source.id, s.source.title) : (s.archive ?? '')}${s.years ? ` ${s.years.from}–${s.years.to}` : ''}${s.pages ? `, pages ${s.pages}` : ''}: ${s.found ? 'found' : 'not found'}${s.note ? `. ${s.note}` : ''}`,
        ),
    ),
  );
  return `${head}\n${body.join('\n').trimEnd()}\n`;
}

/** Every file of the Markdown Export, by path, given the slug of every record and lead. */
export function markdownFiles(tree: ExportTree, slugs: ReadonlyMap<string, string>): Map<string, string> {
  const ctx: Ctx = { slugs, titles: tree.titles };
  const files = new Map<string, string>([['README.md', README]]);
  for (const r of tree.records) {
    const slug = slugs.get(r.id);
    if (!slug) continue;
    const kind = r.kind as RecordKind;
    const text = kind === 'person' ? personNote(ctx, r) : kind === 'family' ? familyNote(ctx, r) : genericNote(ctx, r);
    files.set(`${FOLDERS[kind]}/${slug}.md`, text);
  }
  for (const l of tree.leads) {
    const slug = slugs.get(l.id);
    if (slug) files.set(`${FOLDERS.lead}/${slug}.md`, leadNote(ctx, l));
  }
  return files;
}

/** What each record's slug is made from: a Person's name and birth year, a Place's name … */
export function slugBases(tree: ExportTree): Array<{ kind: RecordKind | 'lead'; id: string; base: string }> {
  return [
    ...tree.records.map((r) => ({
      kind: r.kind as RecordKind,
      id: r.id,
      base: r.kind === 'person' ? `${tree.titles.get(r.id) ?? ''} ${r.hasBirthYear ? r.birthYear : ''}` : (tree.titles.get(r.id) ?? r.kind),
    })),
    ...tree.leads.map((l) => ({ kind: 'lead' as const, id: l.id, base: `lead ${l.question}` })),
  ];
}
