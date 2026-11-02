// Turns a filled-in Propose form into the typed operations of one Proposal
// (shared/src/schemas/proposals.ts). Pure functions, so they are unit-tested
// without a browser. Records created in the Proposal get temporary ids.

/** @typedef {import('./types.js').OperationInput} OperationInput */
/** @typedef {import('./types.js').Sex} Sex */
/** @typedef {import('./types.js').NameType} NameType */
/** @typedef {import('./types.js').EventType} EventType */
/** @typedef {import('./types.js').SourceType} SourceType */
/** @typedef {import('./types.js').Confidence} Confidence */
/** @typedef {import('./types.js').RoleType} RoleType */

export const KINDS = /** @type {const} */ (['baptism', 'marriage', 'death', 'name', 'correction', 'notes']);
/** @typedef {typeof KINDS[number]} ProposeKind */
export const OPERATIONS_VERSION = 1;

/**
 * A Person in a form: one already in the Tree, or a new one by name.
 * @typedef {{ mode: 'existing', id: string, version: number, label: string }
 *   | { mode: 'new', given: string, surname: string, sex: Sex, asFound?: string }} PersonInput
 */

/** @typedef {{ id: string, label: string }} PlaceChoice a Place of the Tree */
/** @typedef {{ id: string, label: string, type?: SourceType }} SourceChoice a Source of the Tree (Drafts from before 2026-10 have no type) */

/**
 * @typedef {object} CitationForm
 * @property {'new' | 'existing' | 'account'} sourceMode
 * @property {SourceChoice | null} [source] an existing Source
 * @property {SourceType} [sourceType] parish_register, census, land_book or other
 * @property {string} [title]
 * @property {string} [repository]
 * @property {string} [reference]
 * @property {string} [givenBy] who gave the Family account
 * @property {string} [givenOn] when (EDTF)
 * @property {string} [page]
 * @property {string} [transcription]
 * @property {Confidence} [confidence]
 * @property {string} [readOn] ISO day
 */

/** @typedef {{ citation: CitationForm, note: string }} FormBase */
/** @typedef {{ date: string, place: PlaceChoice | null }} EventFields */
/**
 * @typedef {FormBase & EventFields & { eventType: 'baptism' | 'birth', child: PersonInput | null,
 *   father: PersonInput | null, mother: PersonInput | null, godparents: (PersonInput | null)[] }} BaptismForm
 */
/** @typedef {FormBase & EventFields & { partner1: PersonInput | null, partner2: PersonInput | null, witnesses: (PersonInput | null)[] }} MarriageForm */
/** @typedef {FormBase & EventFields & { eventType: 'death' | 'burial', person: PersonInput | null }} DeathForm */
/**
 * A new Name: its type and, apart, the language it is written in (a BCP 47 tag, or '' when not known).
 * Drafts written before Names carried a language tag may still hold the type 'latin' or 'german'.
 * @typedef {FormBase & { person: PersonInput | null, given: string, surname: string, type: NameType | 'latin' | 'german', language?: string, asFound: string }} NameForm
 */
/**
 * The Name or Event a correction changes, with its values when it was picked.
 * @typedef {{ record: 'name' | 'event', id: string, version: number, label: string, current: Record<string, string> }} CorrectionTarget
 */
/** @typedef {FormBase & { person: PersonInput | null, target: CorrectionTarget | null, set: Record<string, string> }} CorrectionForm */
/**
 * Research notes and Labels of a Person (tree-model spec, "Research notes on records", "Labels on
 * Persons"). `base` is the Person as loaded when picked: its version, notes and Labels, so that
 * only what the Member changed is proposed.
 * @typedef {FormBase & { person: PersonInput | null, notes: string, labels: string[],
 *   base: { version: number, notes: string, labels: string[] } | null }} NotesForm
 */
/** @typedef {{ baptism: BaptismForm, marriage: MarriageForm, death: DeathForm, name: NameForm, correction: CorrectionForm, notes: NotesForm }} FormByKind */
/**
 * A kind of finding with its form, as a Draft holds them.
 * @typedef {{ [K in ProposeKind]: { kind: K, form: FormByKind[K] } }[ProposeKind]} KindForm
 */

/**
 * @typedef {object} BuildContext
 * @property {string[]} uploadIds uploaded photos of the Draft
 * @property {{ id: string, version: number } | null} [family] the existing Family of both parents (or partners)
 */

// Choices offered by the forms; tests/unit/proposal-contract.test.mjs checks them against shared/.
/** @type {readonly SourceType[]} */
export const NEW_SOURCE_TYPES = ['parish_register', 'census', 'land_book', 'other'];
/** @type {readonly Confidence[]} */
export const CONFIDENCES = ['very_low', 'low', 'normal', 'high', 'very_high'];
/** @type {readonly NameType[]} */
export const NAME_TYPES = ['other', 'birth', 'married', 'nickname'];
/** Languages offered for a Name, as BCP 47 tags; '' is "not known" (tree-model spec, "Names carry a language tag"). */
export const NAME_LANGUAGES = ['la', 'de', 'cs', 'pl', 'sk', 'ru', ''];
/** @type {readonly Sex[]} */
export const SEXES = ['unknown', 'female', 'male'];

/** @param {string | undefined | null} s */
const clean = (s) => (s ?? '').trim();

/**
 * A value formProblems requires, so a form that skipped them fails with a clear message.
 * @template T
 * @param {T | null | undefined} value
 * @param {string} what
 * @returns {T}
 */
function present(value, what) {
  if (value === null || value === undefined) throw new Error(`The form has no ${what}; check formProblems before building`);
  return value;
}
/** @param {string | undefined | null} s */
const orNull = (s) => (clean(s) === '' ? null : clean(s));

/** Today as an ISO day where the Member is (not in UTC, which is yesterday in Czechia until 1 or 2 a.m.). */
export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Source types whose images show pages of the Source itself; images of other Sources are photos. */
const PAGED_SOURCES = new Set(['parish_register', 'census', 'land_book']);

/**
 * @param {CitationForm} c
 * @returns {SourceType | undefined}
 */
function sourceTypeOf(c) {
  if (c.sourceMode === 'existing') return c.source?.type;
  if (c.sourceMode === 'account') return 'family_account';
  return c.sourceType || 'parish_register';
}

/**
 * An empty form of a kind.
 * @param {ProposeKind} kind
 * @returns {KindForm}
 */
export function emptyForm(kind) {
  /** @type {FormBase} */
  const base = {
    citation: {
      sourceMode: 'new',
      sourceType: 'parish_register',
      title: '',
      repository: '',
      reference: '',
      page: '',
      transcription: '',
      confidence: 'normal',
      readOn: today(),
    },
    note: '',
  };
  switch (kind) {
    case 'baptism':
      return {
        kind,
        form: {
          ...base,
          eventType: 'baptism',
          date: '',
          place: null,
          child: { mode: 'new', given: '', surname: '', sex: 'unknown' },
          father: null,
          mother: null,
          godparents: [],
        },
      };
    case 'marriage':
      return { kind, form: { ...base, date: '', place: null, partner1: null, partner2: null, witnesses: [] } };
    case 'death':
      return { kind, form: { ...base, eventType: 'death', date: '', place: null, person: null } };
    case 'name':
      return { kind, form: { ...base, person: null, given: '', surname: '', type: 'other', language: 'la', asFound: '' } };
    case 'correction':
      return { kind, form: { ...base, person: null, target: null, set: {} } };
    case 'notes':
      return { kind, form: { ...base, person: null, notes: '', labels: [], base: null } };
  }
}

/** A Label as the server compares it: ignoring case, diacritics and outer spaces. @param {string} label */
export const foldLabel = (label) => label.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The Labels added and taken off, compared ignoring case and diacritics.
 * @param {NotesForm} form
 */
export function labelChanges(form) {
  const before = form.base?.labels ?? [];
  const has = (/** @type {string[]} */ list, /** @type {string} */ l) => list.some((x) => foldLabel(x) === foldLabel(l));
  const after = form.labels.map(clean).filter((l, i, all) => l !== '' && all.findIndex((x) => foldLabel(x) === foldLabel(l)) === i);
  return { added: after.filter((l) => !has(before, l)), removed: before.filter((l) => !has(after, l)) };
}

/** Whether a notes form changes anything. @param {NotesForm} form */
function notesChanged(form) {
  const { added, removed } = labelChanges(form);
  return clean(form.notes) !== clean(form.base?.notes) || added.length > 0 || removed.length > 0;
}

/**
 * @param {PersonInput | null | undefined} p
 * @returns {p is PersonInput}
 */
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
 * What a correction is missing: a record and a change, and never an empty spelling as found.
 * @param {CorrectionForm} form
 * @returns {string[]}
 */
function correctionProblems({ target, set }) {
  if (!target || Object.keys(set ?? {}).length === 0) return ['propose.needCorrection'];
  return target.record === 'name' && set.asFound !== undefined && clean(set.asFound) === '' ? ['propose.needAsFound'] : [];
}

/**
 * What a form of its kind is missing, as i18n keys.
 * @param {KindForm} draft
 * @returns {string[]}
 */
function kindProblems(draft) {
  switch (draft.kind) {
    case 'baptism':
      return isPerson(draft.form.child) ? [] : ['propose.needChild'];
    case 'marriage':
      return isPerson(draft.form.partner1) && isPerson(draft.form.partner2) ? [] : ['propose.needPartners'];
    case 'death':
      return isPerson(draft.form.person) ? [] : ['propose.needPerson'];
    case 'name':
      return draft.form.person?.mode === 'existing' && (clean(draft.form.given) !== '' || clean(draft.form.surname) !== '') ? [] : ['propose.needName'];
    case 'correction':
      return correctionProblems(draft.form);
    case 'notes':
      return draft.form.person?.mode === 'existing' && draft.form.base && notesChanged(draft.form) ? [] : ['propose.needNotes'];
  }
}

/** @param {CitationForm} c */
function hasSource(c) {
  if (c.sourceMode === 'existing') return Boolean(c.source?.id);
  if (c.sourceMode === 'account') return clean(c.givenBy) !== '' && clean(c.givenOn) !== '';
  return clean(c.title) !== '';
}

/**
 * Problems that stop a Draft from being submitted, as i18n keys.
 * @param {KindForm} draft
 * @returns {string[]}
 */
export function formProblems(draft) {
  // Notes and Labels state no fact: they need no Citation (tree-model spec, "Research notes on records").
  if (draft.kind === 'notes') return kindProblems(draft);
  const c = draft.form.citation ?? { sourceMode: 'new' };
  return [...kindProblems(draft), ...(hasSource(c) && clean(c.transcription) !== '' ? [] : ['propose.needEvidence'])];
}

class Builder {
  constructor() {
    /** @type {OperationInput[]} */
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
    this.ops.push({
      op: 'createPerson',
      tempId,
      sex: p.sex ?? 'unknown',
      name: { given, surname, type: 'birth', asFound: clean(p.asFound) || `${given} ${surname}`.trim() },
    });
    return tempId;
  }

  /**
   * @param {EventType} type
   * @param {EventFields} form
   */
  event(type, form) {
    const tempId = this.temp('event');
    this.ops.push({ op: 'createEvent', tempId, type, date: orNull(form.date), placeId: form.place?.id ?? null });
    return tempId;
  }

  /**
   * @param {string} eventId
   * @param {string} personId
   * @param {RoleType} role
   */
  role(eventId, personId, role) {
    this.ops.push({ op: 'addRole', eventId, personId, role });
  }

  /**
   * The Source of a Citation: an existing one, or a new one created here.
   * @param {CitationForm} c
   */
  source(c) {
    if (c.sourceMode === 'existing' && c.source) return c.source.id;
    const tempId = this.temp('source');
    if (c.sourceMode === 'account') {
      this.ops.push({
        op: 'createSource',
        tempId,
        type: 'family_account',
        title: clean(c.title) || `${clean(c.givenBy)}, ${clean(c.givenOn)}`,
        familyAccount: { givenBy: clean(c.givenBy), givenByPersonId: null, givenOn: clean(c.givenOn) },
      });
    } else {
      this.ops.push({
        op: 'createSource',
        tempId,
        type: c.sourceType || 'parish_register',
        title: clean(c.title),
        repository: orNull(c.repository),
        reference: orNull(c.reference),
      });
    }
    return tempId;
  }

  /**
   * The Citation, with its Source when new, and the Draft's photos. Returns the Citation's id.
   * @param {CitationForm} c
   * @param {string[]} uploadIds
   */
  citation(c, uploadIds) {
    const sourceId = this.source(c);
    const citationId = this.temp('citation');
    this.ops.push({
      op: 'createCitation',
      tempId: citationId,
      sourceId,
      page: c.sourceMode === 'account' ? null : orNull(c.page),
      transcription: clean(c.transcription),
      readOn: c.readOn || today(),
      confidence: c.confidence || 'normal',
    });
    const type = sourceTypeOf(c);
    const kind = type && PAGED_SOURCES.has(type) ? 'page' : 'photo';
    for (const uploadId of uploadIds) this.ops.push({ op: 'addImage', uploadId, kind, citationId });
    return citationId;
  }

  /**
   * The Citation, attached to an Event or a Name.
   * @param {CitationForm} c
   * @param {BuildContext} ctx
   * @param {{ eventId: string } | { nameId: string }} target
   * @param {number} [baseVersion] of the target, when it is in the Tree already
   */
  cite(c, ctx, target, baseVersion) {
    const citationId = this.citation(c ?? { sourceMode: 'new' }, ctx.uploadIds);
    this.ops.push({ op: 'attachCitation', citationId, ...target, ...(baseVersion === undefined ? {} : { baseVersion }) });
  }
}

/**
 * @param {Builder} b
 * @param {BaptismForm} form
 * @param {BuildContext} ctx
 */
function buildBaptism(b, form, ctx) {
  const event = b.event(form.eventType === 'birth' ? 'birth' : 'baptism', form);
  const child = b.person(present(form.child, 'child'), 'child');
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
  b.cite(form.citation, ctx, { eventId: event });
}

/**
 * @param {Builder} b
 * @param {MarriageForm} form
 * @param {BuildContext} ctx
 */
function buildMarriage(b, form, ctx) {
  const event = b.event('marriage', form);
  const p1 = b.person(present(form.partner1, 'first partner'), 'partner');
  const p2 = b.person(present(form.partner2, 'second partner'), 'partner');
  b.role(event, p1, 'partner');
  b.role(event, p2, 'partner');
  for (const w of form.witnesses ?? []) if (isPerson(w)) b.role(event, b.person(w, 'witness'), 'witness');
  if (!ctx.family) b.ops.push({ op: 'createFamily', tempId: b.temp('family'), partner1Id: p1, partner2Id: p2 });
  b.cite(form.citation, ctx, { eventId: event });
}

/**
 * @param {Builder} b
 * @param {DeathForm} form
 * @param {BuildContext} ctx
 */
function buildDeath(b, form, ctx) {
  const event = b.event(form.eventType === 'burial' ? 'burial' : 'death', form);
  b.role(event, b.person(present(form.person, 'deceased'), 'deceased'), 'deceased');
  b.cite(form.citation, ctx, { eventId: event });
}

/**
 * A Name form's type and language tag. A Draft from before the tags says 'latin' or 'german':
 * those are forms of type other in Latin or German now.
 * @param {NameForm} form
 * @returns {{ type: NameType, language: string | null }}
 */
export function nameKind(form) {
  if (form.type === 'latin') return { type: 'other', language: 'la' };
  if (form.type === 'german') return { type: 'other', language: 'de' };
  return { type: form.type || 'other', language: clean(form.language) || null };
}

/**
 * @param {Builder} b
 * @param {NameForm} form
 * @param {BuildContext} ctx
 */
function buildName(b, form, ctx) {
  const person = present(form.person, 'Person');
  if (person.mode !== 'existing') throw new Error('A new Name is for a Person in the Tree');
  const nameId = b.temp('name');
  const { type, language } = nameKind(form);
  b.ops.push({
    op: 'addName',
    tempId: nameId,
    personId: person.id,
    baseVersion: person.version,
    given: clean(form.given),
    surname: clean(form.surname),
    type,
    language,
    asFound: clean(form.asFound) || `${clean(form.given)} ${clean(form.surname)}`.trim(),
  });
  b.cite(form.citation, ctx, { nameId });
}

/**
 * @param {Builder} b
 * @param {CorrectionForm} form
 * @param {BuildContext} ctx
 */
function buildCorrection(b, form, ctx) {
  const target = present(form.target, 'record to correct');
  /** @type {Record<string, unknown>} */
  const set = {};
  // An emptied Event field is cleared; a Name's fields are text and stay text (formProblems refuses an empty spelling as found).
  for (const [field, value] of Object.entries(form.set ?? {})) set[field] = target.record === 'event' && value.trim() === '' ? null : value;
  b.ops.push({ op: 'setField', record: target.record, id: target.id, baseVersion: target.version, set });
  b.cite(form.citation, ctx, target.record === 'event' ? { eventId: target.id } : { nameId: target.id }, target.version);
}

/**
 * Research notes and Labels: what changed against the Person as loaded.
 * @param {Builder} b
 * @param {NotesForm} form
 */
function buildNotes(b, form) {
  const person = present(form.person, 'Person');
  const base = present(form.base, 'Person as loaded');
  if (person.mode !== 'existing') throw new Error('Notes are for a Person in the Tree');
  if (clean(form.notes) !== clean(base.notes))
    b.ops.push({ op: 'setNotes', record: 'person', id: person.id, baseVersion: base.version, notes: clean(form.notes) === '' ? null : form.notes.trim() });
  const { added, removed } = labelChanges(form);
  for (const label of removed) b.ops.push({ op: 'removeLabel', personId: person.id, baseVersion: base.version, label });
  for (const label of added) b.ops.push({ op: 'addLabel', personId: person.id, baseVersion: base.version, label });
}

/**
 * The operations of one Proposal for a filled-in form (one that has no formProblems).
 * @param {KindForm} draft
 * @param {BuildContext} ctx
 * @returns {OperationInput[]}
 */
export function buildOperations(draft, ctx) {
  const b = new Builder();
  switch (draft.kind) {
    case 'baptism':
      buildBaptism(b, draft.form, ctx);
      break;
    case 'marriage':
      buildMarriage(b, draft.form, ctx);
      break;
    case 'death':
      buildDeath(b, draft.form, ctx);
      break;
    case 'name':
      buildName(b, draft.form, ctx);
      break;
    case 'correction':
      buildCorrection(b, draft.form, ctx);
      break;
    case 'notes':
      buildNotes(b, draft.form);
      break;
  }
  return b.ops;
}

/**
 * The Person a Draft is about, and the second partner of a marriage.
 * @param {KindForm} draft
 * @returns {[PersonInput | null, PersonInput | null]}
 */
function draftPersons(draft) {
  switch (draft.kind) {
    case 'baptism':
      return [draft.form.child, null];
    case 'marriage':
      return [draft.form.partner1, draft.form.partner2];
    default:
      return [draft.form.person, null];
  }
}

/**
 * A short title for a Draft in the list, e.g. "Baptism: Václav Dvořák".
 * @param {KindForm} draft
 * @param {(key: string) => string} translate
 */
export function draftTitle(draft, translate) {
  const [who, second] = draftPersons(draft);
  const name = isPerson(who) ? personLabel(who) : translate('propose.unnamed');
  return `${translate(`propose.kind.${draft.kind}`)}: ${name}${isPerson(second) ? ` & ${personLabel(second)}` : ''}`;
}
