import { foldForSearch } from '@rodokmen/shared';
import type { Db } from '../db/db.js';
import type { ExportSlugTable } from '../db/export-types.js';

/**
 * Slugs of exported records (exports design, "Export layout"): made once from the record's name,
 * such as `jan-novak-1801`, and kept in export_slug, so that a later Name correction does not
 * rename the note and break links. Unique across kinds: a `[[slug]]` link names one note.
 */

export type SlugKind = ExportSlugTable['kind'];

const MAX = 60;

/** A slug from a text: lower case ASCII letters and digits, words joined by hyphens. */
export function slugify(text: string): string {
  const words = foldForSearch(text)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  let out = '';
  for (const w of words) {
    if (out.length + w.length + 1 > MAX) break;
    out = out ? `${out}-${w}` : w;
  }
  return out || words[0]?.slice(0, MAX) || '';
}

/**
 * The slug of each record, given once: new records get one from `base` (their name), with `-2`,
 * `-3` … when it is taken. Existing slugs are never changed.
 */
export async function slugsFor(db: Db, records: ReadonlyArray<{ kind: SlugKind; id: string; base: string }>): Promise<Map<string, string>> {
  const existing = await db.selectFrom('export_slug').select(['record_id', 'slug']).execute();
  const out = new Map(existing.map((r) => [r.record_id, r.slug]));
  const taken = new Set(existing.map((r) => r.slug));
  const fresh: Array<{ record_id: string; kind: SlugKind; slug: string }> = [];
  for (const r of records) {
    if (out.has(r.id)) continue;
    const base = slugify(r.base) || r.kind;
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    out.set(r.id, slug);
    fresh.push({ record_id: r.id, kind: r.kind, slug });
  }
  for (let i = 0; i < fresh.length; i += 500)
    await db
      .insertInto('export_slug')
      .values(fresh.slice(i, i + 500))
      .execute();
  return out;
}
