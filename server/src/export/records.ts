import type { ExportRecord } from '@rodokmen/shared';

/**
 * What the steps that gather the Export share (gather.ts, gather-places.ts): the record kinds,
 * a blank record, and the shell's part of "No images in any Export": which links point at an
 * image or a document, and taking those out of notes.
 */

/** Record kinds in the order of the Export's folders. */
export const KINDS = ['person', 'family', 'place', 'house', 'parish', 'estate', 'source'] as const;
export type RecordKind = (typeof KINDS)[number];
export const KIND_ORDER = new Map<string, number>(KINDS.map((k, i) => [k, i]));

/** Whether a kind is one of the record kinds. */
export function isRecordKind(kind: string): kind is RecordKind {
  return KIND_ORDER.has(kind);
}

/** What the steps add to: the records, and the titles that link texts use. */
export interface Gathered {
  records: ExportRecord[];
  titles: Map<string, string>;
}

/** Links to the server's own images and documents, and to files that are images or documents by their name. */
const MEDIA_URL = /(\/api\/(images|documents|uploads)\/)|(\.(jpe?g|png|webp|heic|heif|gif|tiff?|pdf|docx?)(\?[^)\s]*)?$)/i;
/** An image or a link written into Markdown notes: ![alt](target) and [text](target). */
const MD_IMAGE = /!\[([^\]]*)\]\(([^)]*)\)/g;
const MD_LINK = /\[([^\]]*)\]\(([^)]*)\)/g;
const BARE_URL = /\bhttps?:\/\/[^\s)>\]]+/g;

/** Whether a link points at an image or a document (the proved rule then leaves it out). */
export function linkKind(url: string): 'image' | 'web' {
  return MEDIA_URL.test(url.trim()) ? 'image' : 'web';
}

/**
 * Notes without images and documents: an image embed leaves its alt text, a link to an image or a
 * document leaves its text, and a bare address of one goes. Other links stay.
 */
export function withoutMediaInText(text: string | null): string {
  return (text ?? '')
    .replace(MD_IMAGE, (_m, alt: string) => alt)
    .replace(MD_LINK, (m, label: string, target: string) => (linkKind(target) === 'image' ? label : m))
    .replace(BARE_URL, (url) => (linkKind(url) === 'image' ? '' : url));
}

/** The year of a date written as a single day, month or year (also about or uncertain); none for ranges. */
export function yearOf(date: string | null): number | null {
  const m = date === null ? null : /^(\d{4})(-\d{2}(-\d{2})?)?[~?]?$/.exec(date);
  return m ? Number(m[1]) : null;
}

export function group<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** A record of a kind with nothing in it yet: not Living, no Names, Events, facts, notes or links. */
export function blank(kind: RecordKind, id: string): ExportRecord {
  return {
    kind,
    id,
    living: false,
    concernsLiving: false,
    sex: '',
    names: [],
    relations: [],
    birthYear: 0,
    hasBirthYear: false,
    events: [],
    facts: [],
    notes: '',
    links: [],
  };
}
