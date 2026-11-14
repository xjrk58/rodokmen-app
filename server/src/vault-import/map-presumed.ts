import {
  dayKey,
  dayText,
  MARRIAGE,
  OWN_BIRTH,
  PARENT_DEATH,
  parseEdtf,
  presumeDeaths,
  PRESUMED_DEATH_YEARS,
  type BirthAnchor,
  type BoundChain,
  type ParentLink,
} from '@rodokmen/shared';
import type { MapContext } from './map-places.js';
import { factsOf, marriagesOf, role } from './map-people.js';
import { at, type PlannedProposal } from './plan.js';
import { dateText, isRecord, isValidDate, linkOf, type Vault, type VaultNote } from './reader.js';

/**
 * Presumed death (#132; vault-import spec, "Presumed death when birth is provably long ago"): the
 * Person notes the bounds of shared/src/presumed-death.ts prove born more than 125 years before the
 * run, with the description of their undated death Event. The facts are read from the notes alone,
 * as the Tree will have them: births and baptisms, deaths and burials, the marriages either spouse's
 * note records, fathers and mothers. Nothing else is read into them.
 */
export interface PresumedDeaths {
  /** The description of the death Event, by Person note id. */
  descriptions: Map<string, string>;
  /** False when the parent links contradict each other (someone is their own ancestor). */
  settled: boolean;
}

/** A date's latest day as an integer day, with the date as written; null when it bounds nothing. */
function latestOf(value: unknown): { day: number; text: string } | null {
  const text = dateText(value);
  if (text === null || !isValidDate(text)) return null;
  const iso = parseEdtf(text).latest;
  if (iso === null) return null;
  const [year = 0, month = 0, day = 0] = iso.split('-').map(Number);
  return { day: dayKey(year, month, day), text };
}

/** A Person note's name as the Tree's primary Name shows it. */
function nameOf(note: VaultNote): string {
  const n = isRecord(note.data.name) ? note.data.name : {};
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return `${text(n.given)} ${text(n.surname)}`.trim() || note.id;
}

/** What a fact says, for the step of a chain that starts there; `self` is the Person presumed dead. */
type Clause = (self: number) => string;

export function presumedDeaths(vault: Vault, today: Date): PresumedDeaths {
  const people = vault.notes.filter((n) => n.folder === 'people');
  const index = new Map(people.map((n, i) => [n, i]));
  const personOf = (value: unknown) => {
    const target = vault.byId.get(linkOf(value) ?? '');
    return target?.folder === 'people' ? index.get(target) : undefined;
  };
  const anchors: BirthAnchor[] = [];
  const clauses: Clause[] = [];
  const anchor = (person: number, kind: number, day: number, clause: Clause) => {
    anchors.push({ person, kind, day });
    clauses.push(clause);
  };
  const links: ParentLink[] = [];
  const deaths = people.map((n) => {
    const days = factsOf(n)
      .filter((f) => f.kind === 'death' || f.kind === 'burial')
      .flatMap((f) => latestOf(f.date) ?? []);
    return days.reduce<{ day: number; text: string } | null>((a, d) => (a === null || d.day < a.day ? d : a), null);
  });
  const hasDeath = people.map((n) => factsOf(n).some((f) => f.kind === 'death' || f.kind === 'burial'));
  const ownBirth = people.map(() => false);
  for (const [i, n] of people.entries()) {
    for (const f of factsOf(n)) {
      if (f.kind !== 'birth' && f.kind !== 'baptism') continue;
      const l = latestOf(f.date);
      if (!l) continue;
      ownBirth[i] = true;
      anchor(i, OWN_BIRTH, l.day, () => `${nameOf(n)} ${f.kind === 'baptism' ? 'baptized' : 'born'} ${l.text}`);
    }
    for (const m of marriagesOf(n)) {
      const l = latestOf(m.date);
      if (!l) continue;
      for (const who of [i, personOf(m.spouse)])
        if (who !== undefined)
          anchor(who, MARRIAGE, l.day, (self) => `${who === self ? '' : `${nameOf(people[who]!)} `}married ${l.text}, at least 12 years old`);
    }
    for (const [field, mother] of [
      ['father', false],
      ['mother', true],
    ] as const) {
      const parent = personOf(n.data[field]);
      if (parent === undefined || parent === i) continue;
      links.push({ parent, child: i, mother });
      const death = deaths[parent];
      if (death)
        anchor(
          i,
          PARENT_DEATH,
          death.day,
          (self) => `${nameOf(people[parent]!)}, a parent${i === self ? '' : ` of ${nameOf(n)}`}, died ${death.text}; a child is born at most a year after`,
        );
    }
  }
  const { presumed, settled } = presumeDeaths({ count: people.length, hasDeath, ownBirth, anchors, links }, today);
  const describe = (self: number, chain: BoundChain) => {
    const steps = chain.rules.map((r, k) => {
      if (k === 0) return clauses[r]!(self);
      const who = chain.persons[k] === self ? '' : `${nameOf(people[chain.persons[k]!]!)}, `;
      const from = nameOf(people[chain.persons[k - 1]!]!);
      return r < links.length ? `${who}a parent of ${from}, at least 12 years older` : `${who}a child of ${from}, born at most 60 years after her`;
    });
    // A description holds 4,000 characters: a very long chain keeps its ends.
    const shown = steps.join('; ').length > 3000 ? [...steps.slice(0, 3), `… ${steps.length - 6} more steps …`, ...steps.slice(-3)] : steps;
    const run = today.toISOString().slice(0, 10);
    return `Died, date unknown: born by ${dayText(chain.values.at(-1)!)} at the latest (${shown.join('; ')}), more than ${PRESUMED_DEATH_YEARS} years before ${run}.`;
  };
  return { descriptions: new Map(presumed.map((p) => [people[p.person]!.id, describe(p.person, p.chain)])), settled };
}

/** The undated death Event of a presumed death, in the Person's own Proposal, citing the Vault Source with the note path. */
export function presumedDeath(ctx: MapContext, p: PlannedProposal, note: VaultNote, person: string, citationKey: string): void {
  const description = ctx.presumed.get(note.id);
  if (description === undefined) return;
  const key = `event:${note.id}:presumed-death`;
  ctx.b.create(p, key, 'event', { op: 'createEvent', tempId: '', type: 'death', date: null, placeId: null, houseId: null, description });
  role(ctx, p, key, person, 'deceased');
  ctx.b.link(p, `cite:${key}:${citationKey}`, 'citation link', { op: 'attachCitation', citationId: at(citationKey), eventId: at(key) });
  ctx.b.report('presumedDeath', note.path, description);
}
