import { foldForSearch } from '@rodokmen/shared';
import type { MapContext } from './map-places.js';
import type { PlannedLead, PlannedSearch } from './plan.js';
import { dateText, linksIn, textOf, type VaultNote } from './reader.js';

/**
 * plans/ and log/ (vault-import spec, "Research logs and plans become Research leads"). Each plan
 * is an open Research lead; each log note a lead whose searches are the bullets of its sections
 * headed as found ("… a nalezeno") or as without result ("… bez výsledku"). The lead keeps the
 * note's wording, and links the Persons and Places the note links. Nothing else is read into
 * the prose: a search names its register only when the bullet links one (or an entry of one).
 */
const NOT_FOUND = /bez v[ýy]sledku|nenalezeno|not found|without result/i;
const FOUND = /nalezeno|found/i;
const YEARS = /\b(\d{4})\s*[–-]\s*(\d{4})\b/;
const PAGES = /\b(?:s|str|p|pp|pages?|fol)\.?\s*(\d+\s*[–-]\s*\d+|\d+)/i;

/** The Persons and Places a note links, as plan keys. */
function linkedKeys(ctx: MapContext, note: VaultNote): { personKeys: string[]; placeKeys: string[] } {
  const ids = [...new Set([...linksIn(note.body), ...Object.values(note.data).flatMap((v) => linksIn(v))])];
  const targets = ids.flatMap((id) => {
    const t = ctx.vault.byId.get(id);
    if (!t) ctx.b.report('brokenLink', note.path, `[[${id}]]`);
    return t ? [t] : [];
  });
  const placeText = typeof note.data.place === 'string' ? foldForSearch(note.data.place) : '';
  const byName = placeText ? ctx.vault.notes.filter((n) => n.folder === 'places' && foldForSearch(textOf(n.data.name)) === placeText) : [];
  return {
    personKeys: targets.filter((t) => t.folder === 'people').map((t) => `person:${t.id}`),
    placeKeys: [...new Set([...targets.filter((t) => t.folder === 'places'), ...byName].map((t) => `place:${t.id}`))],
  };
}

/** The register a bullet links: a register note, or the register of a Source note. */
function registerOf(ctx: MapContext, text: string): string | null {
  for (const id of linksIn(text)) {
    const t = ctx.vault.byId.get(id);
    if (t?.folder === 'registers') return `register:${t.id}`;
    const r = t?.folder === 'sources' ? linksIn(t.data.register)[0] : undefined;
    if (r && ctx.vault.byId.get(r)?.folder === 'registers') return `register:${ctx.vault.byId.get(r)!.id}`;
  }
  return null;
}

/** The searches of a log note: the bullets of its found and without-result sections. */
export function searchesOf(ctx: MapContext, note: VaultNote): PlannedSearch[] {
  const out: PlannedSearch[] = [];
  let found: boolean | null = null;
  const searchedOn = dateText(note.data.date) ?? ctx.readOn;
  const searchedBy = typeof note.data.agent === 'string' && note.data.agent.trim() ? note.data.agent.trim().slice(0, 200) : 'Vault log';
  for (const line of note.body.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      found = NOT_FOUND.test(heading[1]!) ? false : FOUND.test(heading[1]!) ? true : null;
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!bullet || found === null) continue;
    const text = bullet[1]!.trim();
    const years = YEARS.exec(text);
    const from = years ? Number(years[1]) : null;
    const to = years ? Number(years[2]) : null;
    const registerKey = registerOf(ctx, text);
    out.push({
      registerKey,
      archive: registerKey ? null : 'not named in the Vault log',
      years: from !== null && to !== null && from <= to ? { from, to } : null,
      pages: PAGES.exec(text)?.[1]?.replace(/\s+/g, '') ?? null,
      searchedOn,
      searchedBy,
      found,
      note: text.slice(0, 4000),
    });
  }
  return out;
}

const firstHeading = (note: VaultNote) => /^#{1,3}\s+(.+)$/m.exec(note.body)?.[1]?.trim() ?? null;

/** The leads of plans/ and log/. */
export function mapLeads(ctx: MapContext): PlannedLead[] {
  const leads: PlannedLead[] = [];
  for (const note of ctx.vault.notes.filter((n) => n.folder === 'plans' || n.folder === 'log')) {
    const topic = typeof note.data.topic === 'string' && note.data.topic.trim() ? note.data.topic.trim() : null;
    const question = (topic ?? firstHeading(note) ?? note.id).slice(0, 1000);
    const reason = (note.body.trim() || note.frontmatterText.trim() || note.path).slice(0, 4000);
    if (note.body.trim().length > 4000) ctx.b.report('unmappedValue', note.path, `${note.folder}: the lead's reason holds the first 4,000 characters`);
    const searches = note.folder === 'log' ? searchesOf(ctx, note) : [];
    const status = note.folder === 'plans' || searches.length === 0 ? 'open' : searches.some((s) => s.found) ? 'found' : 'not_found';
    leads.push({ key: `lead:${note.path}`, path: note.path, hash: note.hash, question, reason, ...linkedKeys(ctx, note), status, searches });
  }
  return leads;
}
