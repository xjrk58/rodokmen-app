/**
 * The rules of Research leads (research-leads spec; GLOSSARY "Research lead", "Search record"),
 * as small pure functions: no I/O, no `await`, plain arrays and records. A lead is a plan, not a
 * fact, so it lives beside the Tree and changes without review; these rules say when it may
 * close as not found, what accepting and undoing a Proposal that answers it does to it, and
 * which of its links may leave the server in an Export.
 *
 * The functions marked `//@ verify` are proved with LemmaScript (ADR 0009, docs/verification.md).
 * Which leads, search records and Living people the server gathers, and what it writes back, are
 * not proved; server/test/leads.test.ts covers them.
 */

export const LEAD_STATUSES = ['open', 'in_progress', 'found', 'not_found'] as const;

/** Whether a status is one of a lead's four: open, in progress, found or not found. */
export function isLeadStatus(status: string): boolean {
  //@ verify
  return status === 'open' || status === 'in_progress' || status === 'found' || status === 'not_found';
}

// ---------------------------------------------------------------- closing as not found

/**
 * Whether a lead may have this status, given how many search records it has (research-leads
 * spec, "What was searched is recorded"): "not found" only with at least one search record, so a
 * negative result always says what was looked at. Open, in progress and found need none. The
 * server asks this whenever a lead gets a status: when it is written, edited or closed.
 */
export function mayHaveStatus(status: string, searches: number): boolean {
  //@ verify
  //@ contract research-leads: What was searched is recorded
  // Scenario "Negative result": a lead closes as not found only with at least one search record.
  //@ ensures status === 'not_found' ==> \result === (searches > 0)
  //@ ensures status === 'not_found' && searches <= 0 ==> !\result
  // Open, in progress and found need no search record.
  //@ ensures status === 'open' || status === 'in_progress' || status === 'found' ==> \result
  // Any other status is refused.
  //@ ensures \result ==> isLeadStatus(status)
  if (status === 'not_found') return searches > 0;
  return isLeadStatus(status);
}

// ---------------------------------------------------------------- leads answered by a Proposal

/** What the answering rule sees of a lead: its status, and the Proposal that answered it ('' for none). */
export interface LeadState {
  readonly id: string;
  readonly status: string;
  readonly foundBy: string;
}

/** Whether a lead is found through this Proposal: marked found when it was accepted, and not changed since. */
export function isFoundBy(lead: LeadState, proposalId: string): boolean {
  //@ verify
  return proposalId !== '' && lead.status === 'found' && lead.foundBy === proposalId;
}

/**
 * Accepting a Proposal that names the leads it answers (research-leads spec, "Findings link back
 * to leads"): exactly those leads become found, linked to the Proposal; every other lead stays as
 * it was. A rejected Proposal never gets here, so its leads stay as they were too.
 */
export function leadsOnAccept(leads: readonly LeadState[], answers: readonly string[], proposalId: string): LeadState[] {
  //@ verify
  //@ contract research-leads: Findings link back to leads
  //@ ensures \result.length === leads.length
  // Scenario "Lead answered": a lead the accepted Proposal names shows found, with a link to the Proposal ...
  //@ ensures forall(i: nat, i < leads.length && answers.includes(leads[i].id) ==> \result[i].id === leads[i].id && \result[i].status === 'found' && \result[i].foundBy === proposalId)
  // ... and a lead it does not name is not touched.
  //@ ensures forall(i: nat, i < leads.length && !answers.includes(leads[i].id) ==> \result[i] === leads[i])
  const out: LeadState[] = [];
  for (const lead of leads) {
    //@ invariant out.length === _lead_idx
    //@ invariant forall(j: nat, j < _lead_idx && answers.includes(leads[j].id) ==> out[j].id === leads[j].id && out[j].status === 'found' && out[j].foundBy === proposalId)
    //@ invariant forall(j: nat, j < _lead_idx && !answers.includes(leads[j].id) ==> out[j] === leads[j])
    if (answers.includes(lead.id)) out.push({ id: lead.id, status: 'found', foundBy: proposalId });
    else out.push(lead);
  }
  return out;
}

/**
 * Undoing an accepted Proposal reopens exactly the leads it marked found and that nobody has
 * closed otherwise since; every other lead stays as it is, so a lead found by hand or through
 * another Proposal is never reopened by this undo.
 */
export function leadsOnUndo(leads: readonly LeadState[], proposalId: string): LeadState[] {
  //@ verify
  //@ contract research-leads: Findings link back to leads
  //@ ensures \result.length === leads.length
  // The undo reopens every lead the Proposal marked found ...
  //@ ensures forall(i: nat, i < leads.length && isFoundBy(leads[i], proposalId) ==> \result[i].id === leads[i].id && \result[i].status === 'open' && \result[i].foundBy === '')
  // ... and nothing else.
  //@ ensures forall(i: nat, i < leads.length && !isFoundBy(leads[i], proposalId) ==> \result[i] === leads[i])
  //@ ensures forall(i: nat, i < leads.length && leads[i].foundBy !== proposalId ==> \result[i] === leads[i])
  const out: LeadState[] = [];
  for (const lead of leads) {
    //@ invariant out.length === _lead_idx
    //@ invariant forall(j: nat, j < _lead_idx && isFoundBy(leads[j], proposalId) ==> out[j].id === leads[j].id && out[j].status === 'open' && out[j].foundBy === '')
    //@ invariant forall(j: nat, j < _lead_idx && !isFoundBy(leads[j], proposalId) ==> out[j] === leads[j])
    if (isFoundBy(lead, proposalId)) out.push({ id: lead.id, status: 'open', foundBy: '' });
    else out.push(lead);
  }
  return out;
}

// ---------------------------------------------------------------- leads in an Export, and on erasure

/** A lead's link to a Person, and whether that Person is Living (or, on erasure, the one erased). */
export interface PersonLink {
  readonly personId: string;
  readonly living: boolean;
}

/** What may leave the server of a lead's links to Persons: whether the lead goes at all, and which links. */
export interface ExportedLinks {
  readonly include: boolean;
  readonly persons: PersonLink[];
}

/**
 * The Person links of a lead in an Export (exports spec, "Living people are reduced in every
 * Export"; research-leads design, "Erasure and Exports"): links to Living people are dropped, and
 * a lead that concerned Living people only is left out, since its question is about them. A lead
 * about nobody in particular, or also about someone not Living, goes with its other links.
 *
 * Erasure uses the same rule with `living` meaning "the erased Person": their links go, and a
 * lead that concerned only them is deleted.
 */
export function exportedPersonLinks(links: readonly PersonLink[]): ExportedLinks {
  //@ verify
  //@ contract exports: Living people are reduced in every Export
  // An exported lead links to no Living person ...
  //@ ensures forall(i: nat, i < \result.persons.length ==> !\result.persons[i].living)
  // ... keeps every link to anyone else, and invents none.
  //@ ensures forall(j: nat, j < links.length && !links[j].living ==> \result.persons.includes(links[j]))
  //@ ensures forall(i: nat, i < \result.persons.length ==> links.includes(\result.persons[i]))
  // A lead about Living people only is left out; any other lead goes.
  //@ ensures links.length > 0 && forall(j: nat, j < links.length ==> links[j].living) ==> !\result.include
  //@ ensures \result.include === (links.length === 0 || \result.persons.length > 0)
  const persons: PersonLink[] = [];
  for (const link of links) {
    //@ invariant forall(i: nat, i < persons.length ==> !persons[i].living)
    //@ invariant forall(j: nat, j < _link_idx && !links[j].living ==> persons.includes(links[j]))
    //@ invariant forall(i: nat, i < persons.length ==> links.includes(persons[i]))
    //@ invariant persons.length > 0 ==> exists(j: nat, j < _link_idx && !links[j].living)
    if (!link.living) persons.push(link);
  }
  return { include: links.length === 0 || persons.length > 0, persons };
}
