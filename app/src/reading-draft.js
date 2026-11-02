// A scan reading as a Draft (scan-reading spec): what the server read, and the Member's check of
// it, entry by entry, until it is submitted as one Proposal. Pure functions, so they are
// unit-tested without a browser (tests/unit/reading-draft.test.mjs runs the Proposals they
// build through shared/'s checkOperations, and this module's mark rule against the proved one).
//
// Every value the reader produced stays marked "read by AI" until the Member confirms its entry
// or changes it (stillReadByAi, the mirror of shared/src/reading.ts). The transcription is kept
// as the page shows it. Nobody is matched or created without the Member's choice. The page's
// Citation has at most normal confidence; the server caps it again on arrival.

/** @typedef {import('./types.js').ReadingView} ReadingView */
/** @typedef {import('./types.js').ReadEntry} ReadEntry */
/** @typedef {import('./types.js').ReadPerson} ReadPerson */
/** @typedef {import('./types.js').ReadName} ReadName */
/** @typedef {import('./types.js').Illegible} Illegible */
/** @typedef {import('./types.js').MatchCandidate} MatchCandidate */
/** @typedef {import('./types.js').LeadSuggestion} LeadSuggestion */
/** @typedef {import('./types.js').ReaderMark} ReaderMark */
/** @typedef {import('./types.js').OperationInput} OperationInput */
/** @typedef {import('./types.js').EventType} EventType */
/** @typedef {import('./types.js').RoleType} RoleType */
/** @typedef {import('./types.js').Sex} Sex */
/** @typedef {import('./types.js').NameType} NameType */
/** @typedef {import('./types.js').Confidence} Confidence */

/**
 * A value as the Member checks it: what it is now, and what the reader read (null: the Member typed it).
 * @typedef {{ value: string, read: string | null }} Checked
 */
/**
 * Who a read person is: an existing Person the Member tapped, a new Person, or not chosen yet.
 * @typedef {{ mode: 'existing', id: string, version: number, label: string } | { mode: 'new' } | null} PersonChoice
 */
/**
 * @typedef {{ id: string, version: number, label: string, score: number, reasons: string[] }} Candidate
 */
/**
 * @typedef {object} PersonCheck
 * @property {string} key p1, p2, … as the reader numbered them
 * @property {RoleType} role
 * @property {string | null} roleDetail
 * @property {Sex} sex
 * @property {Checked} given
 * @property {Checked} surname
 * @property {string} asWritten the name exactly as on the page
 * @property {string} language BCP 47, such as la or de
 * @property {ReadName[]} otherNames further forms on the page
 * @property {string | null} description status or occupation as written
 * @property {Candidate[]} candidates existing Persons it may be, best first
 * @property {PersonChoice} choice
 */
/**
 * @typedef {object} EntryCheck
 * @property {number} page index of the scan
 * @property {EventType} type
 * @property {string | null} typeDetail
 * @property {Checked} date
 * @property {Checked} house
 * @property {string | null} houseId the House of the Place that carried the number then
 * @property {string} transcription as the page shows it; never edited
 * @property {Illegible[]} illegible
 * @property {PersonCheck[]} persons
 * @property {boolean} confirmed the Member checked the entry against the scan
 * @property {boolean} skip left out of the Proposal
 */
/**
 * @typedef {object} ReadingForm
 * @property {string} readingId
 * @property {'reading' | 'done' | 'failed'} state the server's reading: still running, done, or failed
 * @property {string | null} error why it failed
 * @property {string | null} model
 * @property {Array<{ page: number, transcription: string }>} pages
 * @property {EntryCheck[]} entries
 * @property {LeadSuggestion[]} leads
 * @property {string[]} dismissed keys of dismissed lead suggestions
 * @property {{ id: string, label: string } | null} place
 * @property {import('./proposal-build.js').CitationForm} citation
 * @property {string | null} link the archive viewer address, kept as the Citation's link
 * @property {string} note
 */

/** Confidences a Citation from a reading may have: at most normal (capConfidence in shared/src/reading.ts). */
/** @type {readonly Confidence[]} */
export const READING_CONFIDENCES = ['very_low', 'low', 'normal'];

/**
 * Whether a value is still marked "read by AI": from the reader, neither confirmed nor changed.
 * The mirror of stillReadByAi in shared/src/reading.ts, which is proved.
 * @param {boolean} fromReader
 * @param {boolean} confirmed
 * @param {boolean} changed
 */
export function stillReadByAi(fromReader, confirmed, changed) {
  return fromReader && !confirmed && !changed;
}

/** @param {Checked} c @param {boolean} confirmed */
export const isMarked = (c, confirmed) => stillReadByAi(c.read !== null, confirmed, c.read !== null && c.value.trim() !== c.read.trim());

/** @param {string | null | undefined} v @returns {Checked} */
const readValue = (v) => ({ value: v ?? '', read: v ?? '' });

/** @param {string} given @param {string} surname @param {string | null} birth */
function label(given, surname, birth) {
  const name = `${given} ${surname}`.trim();
  return birth ? `${name} (* ${/^\d{4}/.test(birth) ? birth.slice(0, 4) : birth})` : name;
}

/** @param {MatchCandidate} c @returns {Candidate} */
function candidate(c) {
  const reasons = /** @type {const} */ (['name', 'house', 'years', 'place', 'family']).filter((r) => c.reasons[r]);
  return { id: c.person.id, version: c.person.version, label: label(c.person.given, c.person.surname, c.person.birth), score: c.score, reasons };
}

/**
 * @param {ReadPerson} p
 * @param {ReadingView} view
 * @returns {PersonCheck}
 */
function personCheck(p, view) {
  const [first, ...otherNames] = p.names;
  return {
    key: p.key,
    role: p.role,
    roleDetail: p.roleDetail,
    sex: p.sex,
    given: readValue(first?.given),
    surname: readValue(first?.surname),
    asWritten: first?.asWritten ?? '',
    language: first?.language ?? 'und',
    otherNames,
    description: p.description,
    candidates: (view.matches.find((m) => m.key === p.key)?.candidates ?? []).map(candidate),
    choice: null,
  };
}

/**
 * The check of a finished reading. The Source, page, Place and link come from what the Member
 * gave when asking for it.
 * @param {ReadingView} view
 * @param {ReadingForm} form the Draft's form, filled in place
 */
export function fillFromReading(view, form) {
  form.model = view.model;
  if (view.status === 'failed' || !view.result) {
    form.state = view.status === 'failed' ? 'failed' : 'reading';
    form.error = view.error?.message ?? null;
    return form;
  }
  form.state = 'done';
  form.error = null;
  form.pages = view.result.pages.map((p) => ({ page: p.page, transcription: p.transcription }));
  form.entries = view.result.entries.map((e, i) => ({
    page: e.page,
    type: e.type,
    typeDetail: e.typeDetail,
    date: readValue(e.date),
    house: readValue(e.house),
    houseId: view.houses[i] ?? null,
    transcription: e.transcription,
    illegible: e.illegible,
    persons: e.persons.map((p) => personCheck(p, view)),
    confirmed: false,
    skip: false,
  }));
  form.leads = view.leads;
  return form;
}

/**
 * A new reading's form, before the server has read it.
 * @param {string} readingId
 * @param {{ place: { id: string, label: string } | null, citation: import('./proposal-build.js').CitationForm, link: string | null, note: string }} given
 * @returns {ReadingForm}
 */
export function newReadingForm(readingId, given) {
  return { readingId, state: 'reading', error: null, model: null, pages: [], entries: [], leads: [], dismissed: [], ...given };
}

/**
 * What stops a checked reading from being submitted, as i18n keys.
 * @param {ReadingForm} form
 * @returns {string[]}
 */
export function readingProblems(form) {
  if (form.state !== 'done') return ['reading.notRead'];
  const included = form.entries.filter((e) => !e.skip);
  const problems = [];
  if (included.length === 0) problems.push('reading.needEntry');
  if (included.some((e) => e.persons.some((p) => p.choice === null))) problems.push('reading.needChoice');
  const c = form.citation;
  const source = c.sourceMode === 'existing' ? Boolean(c.source?.id) : (c.title ?? '').trim() !== '';
  if (!source) problems.push('reading.needSource');
  return problems;
}

/** @param {string} tag @returns {NameType} */
export function nameTypeForLanguage(tag) {
  const language = tag.toLowerCase().split('-')[0];
  return language === 'la' ? 'latin' : language === 'de' ? 'german' : 'other';
}

/** @param {string} s */
const clean = (s) => s.trim();

/**
 * @typedef {object} ReadingContext
 * @property {string[]} uploadIds the Draft's photos, by page
 * @property {Map<number, { id: string, version: number } | null>} [families] for an entry whose parents are both in the Tree: their Family
 * @property {string} readOn ISO day
 */

class ReadingBuilder {
  constructor() {
    /** @type {OperationInput[]} */
    this.ops = [];
    /** @type {ReaderMark[]} */
    this.marks = [];
  }

  /**
   * @param {OperationInput} op
   * @param {string[]} [marked] its fields still as read
   */
  push(op, marked = []) {
    if (marked.length) this.marks.push({ position: this.ops.length, fields: marked });
    this.ops.push(op);
  }
}

/**
 * The fields still read by AI, of those named.
 * @param {Record<string, Checked | null>} fields
 * @param {boolean} confirmed
 */
const markedOf = (fields, confirmed) =>
  Object.entries(fields)
    .filter(([, c]) => c !== null && isMarked(c, confirmed))
    .map(([name]) => name);

/**
 * @param {ReadingBuilder} b
 * @param {PersonCheck} p
 * @param {string} tempId
 * @param {boolean} confirmed
 */
function newPerson(b, p, tempId, confirmed) {
  const given = clean(p.given.value);
  const surname = clean(p.surname.value);
  const asWritten = clean(p.asWritten) || `${given} ${surname}`.trim();
  b.push(
    {
      op: 'createPerson',
      tempId,
      sex: p.sex,
      name: { given: given || surname ? given : asWritten, surname, type: nameTypeForLanguage(p.language), asFound: asWritten },
    },
    [...markedOf({ 'name.given': p.given, 'name.surname': p.surname }, confirmed), ...(confirmed ? [] : ['sex', 'name.asFound'])],
  );
  p.otherNames.forEach((n, j) => {
    if (!n.given.trim() && !n.surname.trim()) return;
    b.push(
      {
        op: 'addName',
        tempId: `${tempId}n${j + 2}`,
        personId: tempId,
        given: n.given.trim(),
        surname: n.surname.trim(),
        type: nameTypeForLanguage(n.language),
        asFound: n.asWritten,
      },
      confirmed ? [] : ['given', 'surname', 'asFound'],
    );
  });
}

/**
 * The Family of a baptism's parents or a marriage's partners: linked when both are in the Tree
 * and have one, else a new Family when at least one of them is new.
 * @param {ReadingBuilder} b
 * @param {EntryCheck} e
 * @param {number} n
 * @param {Map<string, string>} ids
 * @param {ReadingContext} ctx
 */
function family(b, e, n, ids, ctx) {
  const keyOf = (/** @type {string} */ role) => e.persons.find((p) => p.role === role);
  const isNew = (/** @type {PersonCheck | undefined} */ p) => p?.choice?.mode === 'new';
  const idOf = (/** @type {PersonCheck | undefined} */ p) => (p ? (ids.get(p.key) ?? null) : null);
  if (e.type === 'baptism' || e.type === 'birth') {
    const [child, father, mother] = [keyOf('child'), keyOf('father'), keyOf('mother')];
    const childId = idOf(child);
    if (!childId || (!father && !mother)) return;
    const existing = ctx.families?.get(n) ?? null;
    if (father && mother && !isNew(father) && !isNew(mother)) {
      if (existing) b.push({ op: 'linkChild', familyId: existing.id, childId, linkType: 'birth', baseVersion: existing.version });
      return;
    }
    const familyId = `tmp:f${n}`;
    b.push({ op: 'createFamily', tempId: familyId, partner1Id: idOf(father), partner2Id: idOf(mother) });
    b.push({ op: 'linkChild', familyId, childId, linkType: 'birth' });
  } else if (e.type === 'marriage') {
    const partners = e.persons.filter((p) => p.role === 'partner');
    if (partners.length === 2 && partners.some(isNew))
      b.push({ op: 'createFamily', tempId: `tmp:f${n}`, partner1Id: idOf(partners[0]), partner2Id: idOf(partners[1]) });
  }
}

/**
 * @param {ReadingBuilder} b
 * @param {EntryCheck} e
 * @param {number} n entry number, from 1
 * @param {ReadingForm} form
 * @param {string} citationId
 * @param {ReadingContext} ctx
 */
function entry(b, e, n, form, citationId, ctx) {
  const eventId = `tmp:e${n}`;
  const house = clean(e.house.value);
  // A House the Tree has for the number is linked; otherwise the number goes in the description.
  const houseId = e.houseId && house === clean(e.house.read ?? '') ? e.houseId : null;
  const description = house && !houseId ? `čp. ${house}` : null;
  const marked = [...markedOf({ date: e.date, ...(description ? { description: e.house } : {}) }, e.confirmed), ...(e.confirmed ? [] : ['type'])];
  b.push(
    {
      op: 'createEvent',
      tempId: eventId,
      type: e.type,
      typeDetail: e.type === 'other' ? e.typeDetail || 'entry' : e.typeDetail,
      date: clean(e.date.value) || null,
      placeId: houseId ? null : (form.place?.id ?? null),
      houseId,
      description,
    },
    marked,
  );
  /** @type {Map<string, string>} */
  const ids = new Map();
  for (const p of e.persons) {
    const choice = p.choice;
    if (!choice) throw new Error(`Choose who ${p.asWritten} is`);
    const personId = choice.mode === 'existing' ? choice.id : `tmp:${p.key}`;
    if (choice.mode === 'new') newPerson(b, p, personId, e.confirmed);
    ids.set(p.key, personId);
    b.push({ op: 'addRole', eventId, personId, role: p.role, roleDetail: p.roleDetail }, e.confirmed ? [] : ['role']);
  }
  family(b, e, n, ids, ctx);
  b.push({ op: 'attachCitation', citationId, eventId });
}

/**
 * One Citation per page that has an entry left in: the page's transcription, the Member's page
 * label and confidence (at most normal), the archive link, and the page's image. By page index.
 * @param {ReadingBuilder} b
 * @param {ReadingForm} form
 * @param {{ e: EntryCheck, n: number }[]} included
 * @param {string} sourceId
 * @param {ReadingContext} ctx
 */
function pageCitations(b, form, included, sourceId, ctx) {
  const c = form.citation;
  const pages = [...new Set(included.map(({ e }) => e.page))].sort((x, y) => x - y);
  const pageLabel = clean(c.page ?? '') || null;
  /** @type {Map<number, string>} */
  const citations = new Map();
  for (const page of pages) {
    const citationId = `tmp:citation${page + 1}`;
    citations.set(page, citationId);
    const onPage = included.filter(({ e }) => e.page === page);
    const text = form.pages.find((p) => p.page === page)?.transcription.trim() || onPage.map(({ e }) => e.transcription).join('\n\n');
    b.push(
      {
        op: 'createCitation',
        tempId: citationId,
        sourceId,
        page: pageLabel && pages.length > 1 ? `${pageLabel} (${page + 1})` : pageLabel,
        transcription: text,
        readOn: c.readOn || ctx.readOn,
        confidence: READING_CONFIDENCES.find((x) => x === c.confidence) ?? 'normal',
        note: form.link ? `Online: ${form.link}` : null,
      },
      onPage.every(({ e }) => e.confirmed) ? [] : ['transcription'],
    );
    const uploadId = ctx.uploadIds[page];
    if (uploadId) b.push({ op: 'addImage', uploadId, kind: 'page', citationId });
  }
  return citations;
}

/**
 * The Proposal of a checked reading: one Citation per page with its image and transcription,
 * the entries' Events with their Roles, new Persons and Families, and the "read by AI" marks of
 * the values the Member neither confirmed nor changed.
 * @param {ReadingForm} form one without readingProblems
 * @param {ReadingContext} ctx
 * @returns {{ operations: OperationInput[], marks: ReaderMark[] }}
 */
export function buildReading(form, ctx) {
  const b = new ReadingBuilder();
  const c = form.citation;
  let sourceId;
  if (c.sourceMode === 'existing' && c.source) sourceId = c.source.id;
  else {
    sourceId = 'tmp:source';
    b.push({
      op: 'createSource',
      tempId: sourceId,
      type: 'parish_register',
      title: clean(c.title ?? ''),
      repository: clean(c.repository ?? '') || null,
      reference: clean(c.reference ?? '') || null,
      url: form.link,
    });
  }
  const included = form.entries.map((e, i) => ({ e, n: i + 1 })).filter(({ e }) => !e.skip);
  const citations = pageCitations(b, form, included, sourceId, ctx);
  for (const { e, n } of included) entry(b, e, n, form, /** @type {string} */ (citations.get(e.page)), ctx);
  return { operations: b.ops, marks: b.marks };
}

/**
 * A short title for the Draft list, such as "Reading: 3 entries (Anna, Josephus, Thomas)".
 * @param {ReadingForm} form
 * @param {(key: string, params?: Record<string, string | number>) => string} translate
 */
export function readingTitle(form, translate) {
  if (form.state !== 'done') return translate('reading.titlePending');
  const children = form.entries.map((e) => e.persons.find((p) => p.role === 'child' || p.role === 'deceased') ?? e.persons[0]).filter((p) => p !== undefined);
  const names = children.map((p) => clean(p.given.value) || p.asWritten).slice(0, 3);
  return translate('reading.title', { count: form.entries.length, names: names.join(', ') });
}
