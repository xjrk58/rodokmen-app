import { isLiving, relationsOf, type FamilyLinkById } from '@rodokmen/shared';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { mapLeads } from './map-leads.js';
import { factsOf, marriagesOf } from './map-people.js';
import { mapPlaces, type MapContext, type Municipality } from './map-places.js';
import { citersOf, mapPersons, mapSources } from './map-sources.js';
import { CONFIDENCE_OF, PlanBuilder, type Plan, type PlannedFile } from './plan.js';
import { dateText, isValidDate, linkOf, textOf, type Vault, type VaultNote } from './reader.js';

/**
 * Maps a Vault to the Proposals of one Import batch (design, "Mapping" and "Proposal order"):
 * the Vault provenance Source, then Places, Parishes, Houses and registers, then the Source notes
 * in date order, then one Proposal per Person for what no Source note covers; and the Research
 * leads of plans/ and log/. Deterministic: the same Vault gives the same plan.
 */
export interface MapOptions {
  municipalities: Municipality[];
  /** Who gave the Vault: the Owner, as the Vault provenance Source names them. */
  givenBy: string;
  /** Family roots, as Vault ids, for comparing the relation to the family with the Vault's tags. */
  roots: readonly string[];
  today: Date;
}

const SIGNATURES: Record<PlannedFile['type'], (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  'application/pdf': (b) => b.toString('latin1', 0, 5) === '%PDF-',
  'application/msword': (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
};

/** Files whose first bytes are not what their name says: reported and left out, with what uses them. */
async function dropUnreadable(vault: Vault, b: PlanBuilder): Promise<void> {
  for (const p of b.proposals) {
    const bad = new Set<string>();
    for (const f of p.files) {
      let head = Buffer.alloc(0);
      try {
        const handle = await open(join(vault.root, f.path), 'r');
        const { buffer, bytesRead } = await handle.read(Buffer.alloc(16), 0, 16, 0);
        head = buffer.subarray(0, bytesRead);
        await handle.close();
      } catch {
        // unreadable: head stays empty
      }
      if (!SIGNATURES[f.type](head)) {
        bad.add(f.path);
        b.report('unreadableFile', f.path, `not a readable ${f.type}`);
      }
    }
    if (bad.size === 0) continue;
    const uses = (v: unknown) => typeof v === 'string' && [...bad].some((path) => v === `@upload:${path}` || v === `@upload:${path}.pdf`);
    p.files = p.files.filter((f) => !bad.has(f.path));
    const kept = p.ops.filter((o) => !uses(o.op.uploadId) && !uses(o.op.originalUploadId));
    for (const o of p.ops)
      if (!kept.includes(o))
        b.records.set(o.op.op === 'addImage' ? 'image' : 'document', (b.records.get(o.op.op === 'addImage' ? 'image' : 'document') ?? 1) - 1);
    p.ops = kept;
  }
}

/** What the Vault's tags say of the relation to the family: nepribuzny, mozny-pribuzny, else a relative. */
const vaultRelation = (note: VaultNote) => {
  const tags = Array.isArray(note.data.tags) ? note.data.tags : [];
  return tags.includes('nepribuzny') ? 'unrelated' : tags.includes('mozny-pribuzny') ? 'possible' : 'relative';
};

/** The confidence of each Source note's Citation, by its id: the lowest its Persons give. */
function sourceConfidences(people: VaultNote[], vault: Vault): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of people) {
    const c = CONFIDENCE_OF[textOf(n.data.confidence)] ?? 'normal';
    for (const s of [...factsOf(n).map((f) => f.source), ...marriagesOf(n).map((m) => m.source)]) {
      const id = linkOf(s);
      if (id && vault.byId.get(id)?.folder === 'sources') out.set(id, out.get(id) === 'low' || c === 'low' ? 'low' : c);
    }
  }
  return out;
}

/** The Family links the Tree will have, with the confidences of their Citations (tree-model spec, "Relation follows the evidence"). */
function familyLinks(people: VaultNote[], vault: Vault): FamilyLinkById[] {
  const confidences = sourceConfidences(people, vault);
  const confidenceOf = (source: unknown) => confidences.get(linkOf(source) ?? '') ?? 'low';
  const links: FamilyLinkById[] = [];
  for (const n of people) {
    const births = factsOf(n).filter((f) => f.kind === 'birth' || f.kind === 'baptism');
    for (const parent of [n.data.father, n.data.mother, n.data.adoptive_father, n.data.adoptive_mother]) {
      const target = vault.byId.get(linkOf(parent) ?? '');
      if (target?.folder === 'people') links.push({ a: target.id, b: n.id, confidences: births.map((f) => confidenceOf(f.source)) });
    }
    for (const m of marriagesOf(n)) {
      const spouse = vault.byId.get(linkOf(m.spouse) ?? '');
      if (spouse?.folder === 'people') links.push({ a: n.id, b: spouse.id, confidences: [confidenceOf(m.source)] });
    }
  }
  return links;
}

/** Whether the Tree will treat a Person as Living, from their dates (tree-model spec, "Living people are computed"). */
function livingInTree(n: VaultNote, today: Date): boolean {
  const facts = factsOf(n);
  const birthDates = facts
    .filter((f) => f.kind === 'birth' || f.kind === 'baptism')
    .map((f) => dateText(f.date))
    .map((d) => (d && isValidDate(d) ? d : null));
  return isLiving({ birthDates, deathRecorded: facts.some((f) => f.kind === 'death' || f.kind === 'burial') }, today);
}

/**
 * Where the Vault and the Tree will disagree (vault-import spec, "Living status is computed, not
 * copied", "Tags become Labels or are derived"): Living from the dates against `living`, and the
 * relation the Tree computes from these Family roots and link confidences against the tags.
 */
function compare(vault: Vault, b: PlanBuilder, options: MapOptions): Plan['comparisons'] {
  const people = vault.notes.filter((n) => n.folder === 'people');
  let living = 0;
  for (const n of people) {
    const computed = livingInTree(n, options.today);
    if (typeof n.data.living !== 'boolean' || n.data.living === computed) continue;
    living++;
    b.report('livingDiffers', n.path, `Vault: ${n.data.living ? 'Living' : 'not Living'}; the Tree: ${computed ? 'Living' : 'not Living'}`);
  }
  const relations = relationsOf(
    people.map((n) => n.id),
    options.roots,
    familyLinks(people, vault),
  );
  let relation = 0;
  for (const n of people) {
    const computed = relations.get(n.id) ?? 'unrelated';
    if (computed === vaultRelation(n)) continue;
    relation++;
    b.report('relationDiffers', n.path, `Vault: ${vaultRelation(n)}; the Tree: ${computed}`);
  }
  return { living, relation };
}

export async function mapVault(vault: Vault, options: MapOptions): Promise<Plan> {
  const b = new PlanBuilder();
  b.issues.push(...vault.issues);
  const readOn = vault.commit?.date ?? options.today.toISOString().slice(0, 10);
  const ctx: MapContext = { b, vault, municipalities: options.municipalities, readOn, parishSeats: new Map() };
  // The Vault provenance Source (design, "Vault provenance Source"): given by the Owner, dated with the Vault's commit.
  const p = b.proposal('vault', 'vault', 'The Vault (rodokmen-data) as a Family account Source', null);
  b.create(p, 'vault-source', 'source', {
    op: 'createSource',
    tempId: '',
    type: 'family_account',
    title: 'Vault (rodokmen-data)',
    reference: vault.commit ? vault.commit.sha.slice(0, 12) : null,
    familyAccount: { givenBy: options.givenBy, givenByPersonId: null, givenOn: readOn },
  });
  b.create(p, 'vault-citation:', 'citation', {
    op: 'createCitation',
    tempId: '',
    sourceId: '@vault-source',
    page: null,
    transcription: `The Owner's Vault of Markdown notes (rodokmen-data)${vault.commit ? ` at commit ${vault.commit.sha}` : ''}, imported once.`,
    readOn,
    confidence: 'low',
    note: null,
  });
  mapPlaces(ctx);
  mapSources(ctx, citersOf(ctx));
  mapPersons(ctx);
  const leads = mapLeads(ctx);
  await dropUnreadable(vault, b);
  // Files in attachments/ that no note lists are not imported: listed, so that none is lost unseen.
  const listed = new Set(b.proposals.flatMap((p) => p.files.map((f) => f.path)));
  for (const i of b.issues) if (i.kind === 'unreadableFile' || i.kind === 'missingFile') listed.add(i.kind === 'missingFile' ? i.detail : i.path);
  for (const f of [...vault.files].sort()) if (!listed.has(f)) b.report('skippedFile', f, 'no note lists it');
  const comparisons = compare(vault, b, options);
  return { proposals: b.proposals, leads, issues: b.issues, comparisons, records: Object.fromEntries(b.records) };
}
