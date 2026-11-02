/**
 * The gap finder's rule (research-leads spec, "Gap finder suggests leads"): from what the Tree
 * knows about its Relatives, which leads to suggest, and which register to check for each.
 *
 * Three kinds of gap, for Relatives only (GLOSSARY "Relative"; never Possible relatives or
 * Unrelated people, to keep large Trees quiet):
 *
 * - `birth`: a Relative with no birth or baptism Citation;
 * - `parents`: a Relative whose parents are unknown, while the Parish and years of their birth or
 *   baptism are known, so the baptism entry can name them;
 * - `marriage`: a Family of two partners, one of them a Relative, whose marriage has no Citation.
 *
 * A gap whose Parish and years are known names each register the Tree holds for that Parish, of
 * the right kind (births for the first two, marriages for the third), whose years meet the gap's,
 * with the years both cover. Without such a register it is suggested on its own. Every
 * suggestion has a stable key, its kind, subject (Person or Family) and register Source; a key a
 * Member dismissed or accepted is never suggested again.
 *
 * {@link suggestGaps} is proved with LemmaScript (ADR 0009, docs/verification.md). Which Persons,
 * Families, Citations, Parishes and registers the server gathers, and the years it derives from
 * EDTF dates, are not proved: server/src/leads/gaps.ts gathers them, server/test/gap-finder.test.ts
 * covers it.
 */

/** What the gap finder knows of one Person. */
export interface GapPerson {
  readonly personId: string;
  /** A Relative: linked to a Family root through confirmed links. */
  readonly relative: boolean;
  /** A birth or baptism Event of theirs (they have the Role child) has a Citation. */
  readonly birthCited: boolean;
  /** They are a child of a Family with at least one partner. */
  readonly parentsKnown: boolean;
  /** Whether the years of their birth or baptism are bounded, `from` to `to`. */
  readonly datesKnown: boolean;
  readonly from: number;
  readonly to: number;
  /** The Parishes their birth or baptism Place belonged to in those years. */
  readonly parishIds: readonly string[];
}

/** What the gap finder knows of one marriage: a Family of two partners. */
export interface GapMarriage {
  readonly familyId: string;
  /** One of the partners is a Relative. */
  readonly relative: boolean;
  /** A marriage Event of the two partners has a Citation. */
  readonly cited: boolean;
  /** Whether the years of a marriage Event of theirs are bounded, `from` to `to`. */
  readonly datesKnown: boolean;
  readonly from: number;
  readonly to: number;
  /** The Parishes the Place of that marriage belonged to in those years. */
  readonly parishIds: readonly string[];
}

/** A register the Tree holds: a Source of one Parish, of one kind (`birth`, `marriage` or `death`), for years `from` to `to`. */
export interface Register {
  readonly sourceId: string;
  readonly parishId: string;
  readonly kind: string;
  readonly from: number;
  readonly to: number;
}

/** A suggested lead. */
export interface GapSuggestion {
  /** `birth`, `parents` or `marriage`. */
  readonly kind: string;
  /** Index of the Person (birth, parents) or the marriage in the input. */
  readonly subject: number;
  readonly subjectId: string;
  /** Index of the register to check in the input; -1 for none. */
  readonly register: number;
  /** The register's Source; '' for none. */
  readonly sourceId: string;
  /** The stable key: kind, subject and Source. */
  readonly key: string;
  /** The years to check; 0 and 0 when unknown. */
  readonly from: number;
  readonly to: number;
}

/** The stable key of a suggestion: the same gap with the same register always has the same key. */
export function gapKey(kind: string, subjectId: string, sourceId: string): string {
  //@ verify
  return kind + ':' + subjectId + ':' + sourceId;
}

export function maxInt(a: number, b: number): number {
  //@ verify
  //@ ensures \result >= a && \result >= b && (\result === a || \result === b)
  return a >= b ? a : b;
}

export function minInt(a: number, b: number): number {
  //@ verify
  //@ ensures \result <= a && \result <= b && (\result === a || \result === b)
  return a <= b ? a : b;
}

/** A Relative with no birth or baptism Citation. */
export function isBirthGap(p: GapPerson): boolean {
  //@ verify
  return p.relative && !p.birthCited;
}

/** A Relative whose parents are unknown while the Parish and years of their birth are known. */
export function isParentsGap(p: GapPerson): boolean {
  //@ verify
  return p.relative && !p.parentsKnown && p.datesKnown && p.parishIds.length > 0;
}

/** A marriage of a Relative without a Citation. */
export function isMarriageGap(m: GapMarriage): boolean {
  //@ verify
  return m.relative && !m.cited;
}

/** Whether a register is worth checking for a gap: its kind, of one of the gap's Parishes, its years meeting the gap's. */
export function fits(reg: Register, kind: string, located: boolean, from: number, to: number, parishIds: readonly string[]): boolean {
  //@ verify
  return reg.kind === kind && located && parishIds.includes(reg.parishId) && reg.from <= to && from <= reg.to;
}

/** Whether any register fits a gap. */
export function anyFits(registers: readonly Register[], kind: string, located: boolean, from: number, to: number, parishIds: readonly string[]): boolean {
  //@ verify
  return registers.some((reg) => fits(reg, kind, located, from, to, parishIds));
}

/** Whether a list holds a suggestion of this kind for this subject and register, with these years. */
export function hasSuggestion(found: readonly GapSuggestion[], kind: string, subject: number, register: number, from: number, to: number): boolean {
  //@ verify
  return found.some((s) => s.kind === kind && s.subject === subject && s.register === register && s.from === from && s.to === to);
}

/** The suggestions for one gap: one per register that fits, or one without a register when none fits; never a decided key. */
export function gapSuggestions(
  kind: string,
  subject: number,
  subjectId: string,
  registerKind: string,
  located: boolean,
  from: number,
  to: number,
  parishIds: readonly string[],
  registers: readonly Register[],
  decided: readonly string[],
): GapSuggestion[] {
  //@ verify
  //@ ensures forall(i: nat, i < \result.length ==> \result[i].kind === kind && \result[i].subject === subject && \result[i].subjectId === subjectId)
  //@ ensures forall(i: nat, i < \result.length ==> \result[i].key === gapKey(kind, subjectId, \result[i].sourceId) && !decided.includes(\result[i].key))
  //@ ensures forall(i: nat, i < \result.length && \result[i].register >= 0 ==> \result[i].register < registers.length && fits(registers[\result[i].register], registerKind, located, from, to, parishIds) && \result[i].sourceId === registers[\result[i].register].sourceId && \result[i].from === maxInt(from, registers[\result[i].register].from) && \result[i].to === minInt(to, registers[\result[i].register].to))
  //@ ensures forall(i: nat, i < \result.length && \result[i].register < 0 ==> \result[i].register === -1 && \result[i].sourceId === '' && !anyFits(registers, registerKind, located, from, to, parishIds))
  //@ ensures forall(r: nat, r < registers.length && fits(registers[r], registerKind, located, from, to, parishIds) && !decided.includes(gapKey(kind, subjectId, registers[r].sourceId)) ==> hasSuggestion(\result, kind, subject, r, maxInt(from, registers[r].from), minInt(to, registers[r].to)))
  //@ ensures !anyFits(registers, registerKind, located, from, to, parishIds) && !decided.includes(gapKey(kind, subjectId, '')) ==> hasSuggestion(\result, kind, subject, -1, located ? from : 0, located ? to : 0)
  const out: GapSuggestion[] = [];
  let fitting = false;
  let r = 0;
  while (r < registers.length) {
    //@ invariant 0 <= r && r <= registers.length
    //@ invariant fitting === exists(j: nat, j < r && fits(registers[j], registerKind, located, from, to, parishIds))
    //@ invariant forall(i: nat, i < out.length ==> out[i].kind === kind && out[i].subject === subject && out[i].subjectId === subjectId)
    //@ invariant forall(i: nat, i < out.length ==> out[i].key === gapKey(kind, subjectId, out[i].sourceId) && !decided.includes(out[i].key))
    //@ invariant forall(i: nat, i < out.length ==> 0 <= out[i].register && out[i].register < r && fits(registers[out[i].register], registerKind, located, from, to, parishIds) && out[i].sourceId === registers[out[i].register].sourceId && out[i].from === maxInt(from, registers[out[i].register].from) && out[i].to === minInt(to, registers[out[i].register].to))
    //@ invariant forall(q: nat, q < r && fits(registers[q], registerKind, located, from, to, parishIds) && !decided.includes(gapKey(kind, subjectId, registers[q].sourceId)) ==> hasSuggestion(out, kind, subject, q, maxInt(from, registers[q].from), minInt(to, registers[q].to)))
    //@ decreases registers.length - r
    const reg = registers[r]!;
    if (fits(reg, registerKind, located, from, to, parishIds)) {
      fitting = true;
      const key = gapKey(kind, subjectId, reg.sourceId);
      if (!decided.includes(key)) {
        out.push({ kind, subject, subjectId, register: r, sourceId: reg.sourceId, key, from: maxInt(from, reg.from), to: minInt(to, reg.to) });
      }
    }
    r = r + 1;
  }
  if (!fitting) {
    const key = gapKey(kind, subjectId, '');
    if (!decided.includes(key)) out.push({ kind, subject, subjectId, register: -1, sourceId: '', key, from: located ? from : 0, to: located ? to : 0 });
  }
  return out;
}

/** Whether a suggestion is a real gap of its kind, with a register that fits it (or none, when none fits). */
export function isRealGap(
  s: GapSuggestion,
  persons: readonly GapPerson[],
  marriages: readonly GapMarriage[],
  registers: readonly Register[],
  margin: number,
): boolean {
  //@ verify
  if (s.kind === 'birth' || s.kind === 'parents') {
    if (s.subject < 0 || s.subject >= persons.length) return false;
    const p = persons[s.subject]!;
    if (s.subjectId !== p.personId) return false;
    if (s.kind === 'birth' && !isBirthGap(p)) return false;
    if (s.kind === 'parents' && !isParentsGap(p)) return false;
    if (s.register >= 0)
      return s.register < registers.length && fits(registers[s.register]!, 'birth', p.datesKnown, p.from - margin, p.to + margin, p.parishIds);
    return !anyFits(registers, 'birth', p.datesKnown, p.from - margin, p.to + margin, p.parishIds);
  }
  if (s.kind === 'marriage') {
    if (s.subject < 0 || s.subject >= marriages.length) return false;
    const m = marriages[s.subject]!;
    if (s.subjectId !== m.familyId || !isMarriageGap(m)) return false;
    if (s.register >= 0)
      return s.register < registers.length && fits(registers[s.register]!, 'marriage', m.datesKnown, m.from - margin, m.to + margin, m.parishIds);
    return !anyFits(registers, 'marriage', m.datesKnown, m.from - margin, m.to + margin, m.parishIds);
  }
  return false;
}

/**
 * The suggested leads for some Persons and marriages, given the registers the Tree holds and the
 * keys already decided (dismissed or accepted). `margin` widens a gap's years on both sides: a
 * baptism may be entered the year after the birth, and an estimate may be off.
 */
export function suggestGaps(
  persons: readonly GapPerson[],
  marriages: readonly GapMarriage[],
  registers: readonly Register[],
  decided: readonly string[],
  margin: number,
): GapSuggestion[] {
  //@ verify
  //@ contract research-leads: Gap finder suggests leads
  // Every suggestion is a real gap of its kind: a Relative without a birth or baptism Citation, a Relative with unknown
  // parents and a known Parish and years, or a Relative's marriage without a Citation; with a register that fits it.
  //@ ensures forall(i: nat, i < \result.length ==> isRealGap(\result[i], persons, marriages, registers, margin))
  //@ ensures forall(i: nat, i < \result.length ==> \result[i].key === gapKey(\result[i].kind, \result[i].subjectId, \result[i].sourceId))
  // Scenario "Dismissed suggestion": a dismissed (or accepted) key is never suggested again.
  //@ ensures forall(i: nat, i < \result.length ==> !decided.includes(\result[i].key))
  // Scenario "Missing baptism": a Relative without a baptism Citation, born in years the Parish's birth register covers,
  // gets a suggestion naming that register and the years both cover (the birth years widened by the margin).
  //@ ensures forall(v: nat, forall(r: nat, v < persons.length && r < registers.length && isBirthGap(persons[v]) && fits(registers[r], 'birth', persons[v].datesKnown, persons[v].from - margin, persons[v].to + margin, persons[v].parishIds) && !decided.includes(gapKey('birth', persons[v].personId, registers[r].sourceId)) ==> hasSuggestion(\result, 'birth', v, r, maxInt(persons[v].from - margin, registers[r].from), minInt(persons[v].to + margin, registers[r].to))))
  //@ ensures forall(v: nat, forall(r: nat, v < persons.length && r < registers.length && isParentsGap(persons[v]) && fits(registers[r], 'birth', persons[v].datesKnown, persons[v].from - margin, persons[v].to + margin, persons[v].parishIds) && !decided.includes(gapKey('parents', persons[v].personId, registers[r].sourceId)) ==> hasSuggestion(\result, 'parents', v, r, maxInt(persons[v].from - margin, registers[r].from), minInt(persons[v].to + margin, registers[r].to))))
  //@ ensures forall(m: nat, forall(r: nat, m < marriages.length && r < registers.length && isMarriageGap(marriages[m]) && fits(registers[r], 'marriage', marriages[m].datesKnown, marriages[m].from - margin, marriages[m].to + margin, marriages[m].parishIds) && !decided.includes(gapKey('marriage', marriages[m].familyId, registers[r].sourceId)) ==> hasSuggestion(\result, 'marriage', m, r, maxInt(marriages[m].from - margin, registers[r].from), minInt(marriages[m].to + margin, registers[r].to))))
  // Every other gap is suggested on its own, unless that was decided.
  //@ ensures forall(v: nat, v < persons.length && isBirthGap(persons[v]) && !anyFits(registers, 'birth', persons[v].datesKnown, persons[v].from - margin, persons[v].to + margin, persons[v].parishIds) && !decided.includes(gapKey('birth', persons[v].personId, '')) ==> hasSuggestion(\result, 'birth', v, -1, persons[v].datesKnown ? persons[v].from - margin : 0, persons[v].datesKnown ? persons[v].to + margin : 0))
  //@ ensures forall(v: nat, v < persons.length && isParentsGap(persons[v]) && !anyFits(registers, 'birth', persons[v].datesKnown, persons[v].from - margin, persons[v].to + margin, persons[v].parishIds) && !decided.includes(gapKey('parents', persons[v].personId, '')) ==> hasSuggestion(\result, 'parents', v, -1, persons[v].from - margin, persons[v].to + margin))
  //@ ensures forall(m: nat, m < marriages.length && isMarriageGap(marriages[m]) && !anyFits(registers, 'marriage', marriages[m].datesKnown, marriages[m].from - margin, marriages[m].to + margin, marriages[m].parishIds) && !decided.includes(gapKey('marriage', marriages[m].familyId, '')) ==> hasSuggestion(\result, 'marriage', m, -1, marriages[m].datesKnown ? marriages[m].from - margin : 0, marriages[m].datesKnown ? marriages[m].to + margin : 0))
  let out: GapSuggestion[] = [];
  let v = 0;
  while (v < persons.length) {
    //@ invariant 0 <= v && v <= persons.length
    //@ invariant forall(i: nat, i < out.length ==> isRealGap(out[i], persons, marriages, registers, margin) && out[i].key === gapKey(out[i].kind, out[i].subjectId, out[i].sourceId) && !decided.includes(out[i].key))
    //@ invariant forall(u: nat, forall(r: nat, u < v && r < registers.length && isBirthGap(persons[u]) && fits(registers[r], 'birth', persons[u].datesKnown, persons[u].from - margin, persons[u].to + margin, persons[u].parishIds) && !decided.includes(gapKey('birth', persons[u].personId, registers[r].sourceId)) ==> hasSuggestion(out, 'birth', u, r, maxInt(persons[u].from - margin, registers[r].from), minInt(persons[u].to + margin, registers[r].to))))
    //@ invariant forall(u: nat, forall(r: nat, u < v && r < registers.length && isParentsGap(persons[u]) && fits(registers[r], 'birth', persons[u].datesKnown, persons[u].from - margin, persons[u].to + margin, persons[u].parishIds) && !decided.includes(gapKey('parents', persons[u].personId, registers[r].sourceId)) ==> hasSuggestion(out, 'parents', u, r, maxInt(persons[u].from - margin, registers[r].from), minInt(persons[u].to + margin, registers[r].to))))
    //@ invariant forall(u: nat, u < v && isBirthGap(persons[u]) && !anyFits(registers, 'birth', persons[u].datesKnown, persons[u].from - margin, persons[u].to + margin, persons[u].parishIds) && !decided.includes(gapKey('birth', persons[u].personId, '')) ==> hasSuggestion(out, 'birth', u, -1, persons[u].datesKnown ? persons[u].from - margin : 0, persons[u].datesKnown ? persons[u].to + margin : 0))
    //@ invariant forall(u: nat, u < v && isParentsGap(persons[u]) && !anyFits(registers, 'birth', persons[u].datesKnown, persons[u].from - margin, persons[u].to + margin, persons[u].parishIds) && !decided.includes(gapKey('parents', persons[u].personId, '')) ==> hasSuggestion(out, 'parents', u, -1, persons[u].from - margin, persons[u].to + margin))
    //@ decreases persons.length - v
    const p = persons[v]!;
    if (isBirthGap(p)) {
      out = [...out, ...gapSuggestions('birth', v, p.personId, 'birth', p.datesKnown, p.from - margin, p.to + margin, p.parishIds, registers, decided)];
    }
    if (isParentsGap(p)) {
      out = [...out, ...gapSuggestions('parents', v, p.personId, 'birth', p.datesKnown, p.from - margin, p.to + margin, p.parishIds, registers, decided)];
    }
    v = v + 1;
  }
  let m = 0;
  while (m < marriages.length) {
    //@ invariant 0 <= m && m <= marriages.length
    //@ invariant forall(i: nat, i < out.length ==> isRealGap(out[i], persons, marriages, registers, margin) && out[i].key === gapKey(out[i].kind, out[i].subjectId, out[i].sourceId) && !decided.includes(out[i].key))
    //@ invariant forall(u: nat, forall(r: nat, u < persons.length && r < registers.length && isBirthGap(persons[u]) && fits(registers[r], 'birth', persons[u].datesKnown, persons[u].from - margin, persons[u].to + margin, persons[u].parishIds) && !decided.includes(gapKey('birth', persons[u].personId, registers[r].sourceId)) ==> hasSuggestion(out, 'birth', u, r, maxInt(persons[u].from - margin, registers[r].from), minInt(persons[u].to + margin, registers[r].to))))
    //@ invariant forall(u: nat, forall(r: nat, u < persons.length && r < registers.length && isParentsGap(persons[u]) && fits(registers[r], 'birth', persons[u].datesKnown, persons[u].from - margin, persons[u].to + margin, persons[u].parishIds) && !decided.includes(gapKey('parents', persons[u].personId, registers[r].sourceId)) ==> hasSuggestion(out, 'parents', u, r, maxInt(persons[u].from - margin, registers[r].from), minInt(persons[u].to + margin, registers[r].to))))
    //@ invariant forall(u: nat, u < persons.length && isBirthGap(persons[u]) && !anyFits(registers, 'birth', persons[u].datesKnown, persons[u].from - margin, persons[u].to + margin, persons[u].parishIds) && !decided.includes(gapKey('birth', persons[u].personId, '')) ==> hasSuggestion(out, 'birth', u, -1, persons[u].datesKnown ? persons[u].from - margin : 0, persons[u].datesKnown ? persons[u].to + margin : 0))
    //@ invariant forall(u: nat, u < persons.length && isParentsGap(persons[u]) && !anyFits(registers, 'birth', persons[u].datesKnown, persons[u].from - margin, persons[u].to + margin, persons[u].parishIds) && !decided.includes(gapKey('parents', persons[u].personId, '')) ==> hasSuggestion(out, 'parents', u, -1, persons[u].from - margin, persons[u].to + margin))
    //@ invariant forall(u: nat, forall(r: nat, u < m && r < registers.length && isMarriageGap(marriages[u]) && fits(registers[r], 'marriage', marriages[u].datesKnown, marriages[u].from - margin, marriages[u].to + margin, marriages[u].parishIds) && !decided.includes(gapKey('marriage', marriages[u].familyId, registers[r].sourceId)) ==> hasSuggestion(out, 'marriage', u, r, maxInt(marriages[u].from - margin, registers[r].from), minInt(marriages[u].to + margin, registers[r].to))))
    //@ invariant forall(u: nat, u < m && isMarriageGap(marriages[u]) && !anyFits(registers, 'marriage', marriages[u].datesKnown, marriages[u].from - margin, marriages[u].to + margin, marriages[u].parishIds) && !decided.includes(gapKey('marriage', marriages[u].familyId, '')) ==> hasSuggestion(out, 'marriage', u, -1, marriages[u].datesKnown ? marriages[u].from - margin : 0, marriages[u].datesKnown ? marriages[u].to + margin : 0))
    //@ decreases marriages.length - m
    const g = marriages[m]!;
    if (isMarriageGap(g)) {
      out = [...out, ...gapSuggestions('marriage', m, g.familyId, 'marriage', g.datesKnown, g.from - margin, g.to + margin, g.parishIds, registers, decided)];
    }
    m = m + 1;
  }
  return out;
}
