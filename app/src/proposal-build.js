// Turns a filled-in Propose form into the typed operations of one Proposal
// (shared/src/schemas/proposals.ts). Pure functions, so they are unit-tested
// without a browser. Records created in the Proposal get temporary ids.

/** @typedef {'baptism' | 'marriage' | 'death' | 'name' | 'correction'} ProposeKind */
export const KINDS = /** @type {const} */ (['baptism', 'marriage', 'death', 'name', 'correction']);
export const OPERATIONS_VERSION = 1;

/**
 * A Person in a form: one already in the Tree, or a new one by name.
 * @typedef {{ mode: 'existing', id: string, version: number, label: string }
 *   | { mode: 'new', given: string, surname: string, sex: 'female' | 'male' | 'unknown', asFound?: string }} PersonInput
 */

/**
 * @typedef {object} CitationForm
 * @property {'new' | 'existing' | 'account'} sourceMode
 * @property {{ id: string, label: string } | null} [source] an existing Source
 * @property {string} [sourceType] parish_register, census, land_book or other
 * @property {string} [title]
 * @property {string} [repository]
 * @property {string} [reference]
 * @property {string} [givenBy] who gave the Family account
 * @property {string} [givenOn] when (EDTF)
 * @property {string} [page]
 * @property {string} [transcription]
 * @property {string} [confidence]
 * @property {string} [readOn] ISO day
 */

/**
 * @typedef {object} BuildContext
 * @property {string[]} uploadIds uploaded photos of the Draft
 * @property {{ id: string, version: number } | null} [family] the existing Family of both parents (or partners)
 */

/** @param {string | undefined | null} s */
const clean = (s) => (s ?? '').trim();
/** @param {string | undefined | null} s */
const orNull = (s) => (clean(s) === '' ? null : clean(s));

/** @param {PersonInput | null | undefined} p */
export function isPerson(p) {
  if (!p) return false;
  if (p.mode === 'existing') return Boolean(p.id);
  return clean(p.given) !== '' || clean(p.surname) !== '';
}

/** @param {PersonInput} p */
export function personLabel(p) {
  return p.mode === 'existing' ? p.label : `${clean(p.given)} ${clean(p.surname)}`.trim();
}

/**
 * Problems that stop a Draft from being submitted, as i18n keys.
 * @param {ProposeKind} kind
 * @param {Record<string, any>} form
 * @returns {string[]}
 */
export function formProblems(kind, form) {
  const problems = [];
  if (kind === 'baptism' && !isPerson(form.child)) problems.push('propose.needChild');
  if (kind === 'marriage' && (!isPerson(form.partner1) || !isPerson(form.partner2))) problems.push('propose.needPartners');
  if (kind === 'death' && !isPerson(form.person)) problems.push('propose.needPerson');
  if (kind === 'name' && (form.person?.mode !== 'existing' || (clean(form.given) === '' && clean(form.surname) === ''))) problems.push('propose.needName');
  if (kind === 'correction' && (!form.target || Object.keys(form.set ?? {}).length === 0)) problems.push('propose.needCorrection');
  /** @type {CitationForm} */
  const c = form.citation ?? { sourceMode: 'new' };
  const hasSource = c.sourceMode === 'existing' ? Boolean(c.source?.id) : c.sourceMode === 'account' ? clean(c.givenBy) !== '' && clean(c.givenOn) !== '' : clean(c.title) !== '';
  if (!hasSource || clean(c.transcription) === '') problems.push('propose.needEvidence');
  return problems;
}

class Builder {
  constructor() {
    /** @type {Record<string, any>[]} */
    this.ops = [];
    this.n = 0;
  }

  /** @param {string} prefix */
  temp(prefix) {
    this.n += 1;
    return `tmp:${prefix}${this.n}`;
  }

  /**
   * The id of a Person, creating it when new.
   * @param {PersonInput} p
   * @param {string} prefix
   */
  person(p, prefix) {
    if (p.mode === 'existing') return p.id;
    const tempId = this.temp(prefix);
    const given = clean(p.given);
    const surname = clean(p.surname);
    this.ops.push({ op: 'createPerson', tempId, sex: p.sex ?? 'unknown', name: { given, surname, type: 'birth', asFound: clean(p.asFound) || `${given} ${surname}`.trim() } });
    return tempId;
  }

  /**
   * @param {string} type
   * @param {Record<string, any>} form
   */
  event(type, form) {
    const tempId = this.temp('event');
    this.ops.push({ op: 'createEvent', tempId, type, date: orNull(form.date), placeId: form.place?.id ?? null });
    return tempId;
  }

  /**
   * @param {string} eventId
   * @param {string} personId
   * @param {string} role
   */
  role(eventId, personId, role) {
    this.ops.push({ op: 'addRole', eventId, personId, role });
  }

  /**
   * The Citation, with its Source when new, and the Draft's photos.
   * @param {CitationForm} c
   * @param {string[]} uploadIds
   */
  citation(c, uploadIds) {
    let sourceId;
    if (c.sourceMode === 'existing' && c.source) {
      sourceId = c.source.id;
    } else if (c.sourceMode === 'account') {
      sourceId = this.temp('source');
      this.ops.push({
        op: 'createSource',
        tempId: sourceId,
        type: 'family_account',
        title: clean(c.title) || `${clean(c.givenBy)}, ${clean(c.givenOn)}`,
        familyAccount: { givenBy: clean(c.givenBy), givenByPersonId: null, givenOn: clean(c.givenOn) },
      });
    } else {
      sourceId = this.temp('source');
      this.ops.push({ op: 'createSource', tempId: sourceId, type: c.sourceType || 'parish_register', title: clean(c.title), repository: orNull(c.repository), reference: orNull(c.reference) });
    }
    const citationId = this.temp('citation');
    this.ops.push({
      op: 'createCitation',
      tempId: citationId,
      sourceId,
      page: c.sourceMode === 'account' ? null : orNull(c.page),
      transcription: clean(c.transcription),
      readOn: c.readOn || new Date().toISOString().slice(0, 10),
      confidence: c.confidence || 'normal',
    });
    const kind = c.sourceMode === 'new' && (c.sourceType ?? 'parish_register') !== 'other' ? 'page' : 'photo';
    for (const uploadId of uploadIds) this.ops.push({ op: 'addImage', uploadId, kind, citationId });
    return citationId;
  }
}

/**
 * The operations of one Proposal for a filled-in form.
 * @param {ProposeKind} kind
 * @param {Record<string, any>} form
 * @param {BuildContext} ctx
 * @returns {Record<string, any>[]}
 */
export function buildOperations(kind, form, ctx) {
  const b = new Builder();
  /** @param {string} target */
  const cite = (target) => {
    const citationId = b.citation(form.citation ?? { sourceMode: 'new' }, ctx.uploadIds);
    return { citationId, target };
  };

  if (kind === 'baptism') {
    const event = b.event(form.eventType === 'birth' ? 'birth' : 'baptism', form);
    const child = b.person(form.child, 'child');
    b.role(event, child, 'child');
    const father = isPerson(form.father) ? b.person(form.father, 'father') : null;
    const mother = isPerson(form.mother) ? b.person(form.mother, 'mother') : null;
    if (father) b.role(event, father, 'father');
    if (mother) b.role(event, mother, 'mother');
    for (const g of form.godparents ?? []) if (isPerson(g)) b.role(event, b.person(g, 'godparent'), 'godparent');
    if (father || mother) {
      if (ctx.family) {
        b.ops.push({ op: 'linkChild', familyId: ctx.family.id, childId: child, linkType: 'birth', baseVersion: ctx.family.version });
      } else {
        const family = b.temp('family');
        b.ops.push({ op: 'createFamily', tempId: family, partner1Id: father, partner2Id: mother });
        b.ops.push({ op: 'linkChild', familyId: family, childId: child, linkType: 'birth' });
      }
    }
    const { citationId } = cite(event);
    b.ops.push({ op: 'attachCitation', citationId, eventId: event });
  } else if (kind === 'marriage') {
    const event = b.event('marriage', form);
    const p1 = b.person(form.partner1, 'partner');
    const p2 = b.person(form.partner2, 'partner');
    b.role(event, p1, 'partner');
    b.role(event, p2, 'partner');
    for (const w of form.witnesses ?? []) if (isPerson(w)) b.role(event, b.person(w, 'witness'), 'witness');
    if (!ctx.family) b.ops.push({ op: 'createFamily', tempId: b.temp('family'), partner1Id: p1, partner2Id: p2 });
    const { citationId } = cite(event);
    b.ops.push({ op: 'attachCitation', citationId, eventId: event });
  } else if (kind === 'death') {
    const event = b.event(form.eventType === 'burial' ? 'burial' : 'death', form);
    b.role(event, b.person(form.person, 'deceased'), 'deceased');
    const { citationId } = cite(event);
    b.ops.push({ op: 'attachCitation', citationId, eventId: event });
  } else if (kind === 'name') {
    const nameId = b.temp('name');
    b.ops.push({
      op: 'addName',
      tempId: nameId,
      personId: form.person.id,
      baseVersion: form.person.version,
      given: clean(form.given),
      surname: clean(form.surname),
      type: form.type || 'other',
      asFound: clean(form.asFound) || `${clean(form.given)} ${clean(form.surname)}`.trim(),
    });
    const { citationId } = cite(nameId);
    b.ops.push({ op: 'attachCitation', citationId, nameId });
  } else if (kind === 'correction') {
    const t = form.target;
    /** @type {Record<string, unknown>} */
    const set = {};
    for (const [field, value] of Object.entries(form.set ?? {})) set[field] = typeof value === 'string' && value.trim() === '' && field !== 'given' && field !== 'surname' ? null : value;
    b.ops.push({ op: 'setField', record: t.record, id: t.id, baseVersion: t.version, set });
    const { citationId } = cite(t.id);
    if (t.record === 'event') b.ops.push({ op: 'attachCitation', citationId, eventId: t.id, baseVersion: t.version });
    if (t.record === 'name') b.ops.push({ op: 'attachCitation', citationId, nameId: t.id, baseVersion: t.version });
  }
  return b.ops;
}

/**
 * A short title for a Draft in the list, e.g. "Baptism: Václav Dvořák".
 * @param {ProposeKind} kind
 * @param {Record<string, any>} form
 * @param {(key: string) => string} t
 */
export function draftTitle(kind, form, t) {
  /** @type {PersonInput | null | undefined} */
  const who = kind === 'baptism' ? form.child : kind === 'marriage' ? form.partner1 : form.person;
  const name = isPerson(who) && who ? personLabel(who) : t('propose.unnamed');
  const second = kind === 'marriage' && isPerson(form.partner2) ? ` & ${personLabel(form.partner2)}` : '';
  return `${t(`propose.kind.${kind}`)}: ${name}${second}`;
}
