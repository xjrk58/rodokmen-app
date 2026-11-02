/**
 * Readable sentences for Proposal operations, in Czech and English, as shown in review and
 * history ("adds godparent Anna Králová to the baptism (1801-03-12)").
 */
import type { UiLanguage } from './common.js';
import type { Operation, SettableRecord } from './proposals.js';
import type { ChildLinkType, Confidence, EventType, ImageKind, NameType, RoleType } from './tree.js';

export type SummaryLanguage = UiLanguage;

/** Labels of the records operations refer to, such as a Person's name or "the baptism (1801-03-12)". */
export interface SummaryContext {
  label(ref: string, language: SummaryLanguage): string;
}

export const EVENT_TYPE_LABELS: Record<SummaryLanguage, Record<EventType, string>> = {
  en: {
    birth: 'birth',
    baptism: 'baptism',
    marriage: 'marriage',
    death: 'death',
    burial: 'burial',
    residence: 'residence',
    census: 'census entry',
    other: 'event',
  },
  cs: {
    birth: 'narození',
    baptism: 'křest',
    marriage: 'sňatek',
    death: 'úmrtí',
    burial: 'pohřeb',
    residence: 'bydliště',
    census: 'záznam sčítání',
    other: 'událost',
  },
};

export const ROLE_LABELS: Record<SummaryLanguage, Record<RoleType, string>> = {
  en: {
    child: 'child',
    father: 'father',
    mother: 'mother',
    partner: 'partner',
    godparent: 'godparent',
    witness: 'witness',
    priest: 'priest',
    deceased: 'deceased',
    informant: 'informant',
    other: 'other role',
  },
  cs: {
    child: 'dítě',
    father: 'otec',
    mother: 'matka',
    partner: 'partner',
    godparent: 'kmotr',
    witness: 'svědek',
    priest: 'kněz',
    deceased: 'zemřelý',
    informant: 'oznamovatel',
    other: 'jiná role',
  },
};

const NAME_TYPE_LABELS: Record<SummaryLanguage, Record<NameType, string>> = {
  en: { birth: 'birth name', married: 'married name', nickname: 'nickname', other: 'other form' },
  cs: { birth: 'rodné jméno', married: 'jméno po sňatku', nickname: 'přezdívka', other: 'jiná podoba' },
};

/** Names of the languages Names are most often written in; any other tag is shown as it is. */
const LANGUAGE_NAMES: Record<SummaryLanguage, Record<string, string>> = {
  en: { cs: 'Czech', la: 'Latin', de: 'German', pl: 'Polish', sk: 'Slovak', ru: 'Russian', uk: 'Ukrainian', hu: 'Hungarian', en: 'English' },
  cs: { cs: 'česky', la: 'latinsky', de: 'německy', pl: 'polsky', sk: 'slovensky', ru: 'rusky', uk: 'ukrajinsky', hu: 'maďarsky', en: 'anglicky' },
};

/** The language of a Name in words ("Latin", "latinsky"), or its tag when it has no common name. */
export function languageName(tag: string, language: SummaryLanguage): string {
  const names = LANGUAGE_NAMES[language];
  return Object.hasOwn(names, tag) ? names[tag]! : tag;
}

/** A Name's type and language, as "other form, Latin". */
const nameKind = (n: { type: NameType; language: string | null }, language: SummaryLanguage) =>
  n.language ? `${NAME_TYPE_LABELS[language][n.type]}, ${languageName(n.language, language)}` : NAME_TYPE_LABELS[language][n.type];

const LINK_TYPE_LABELS: Record<SummaryLanguage, Record<ChildLinkType, string>> = {
  en: { birth: 'birth child', adoptive: 'adoptive child', foster: 'foster child', step: 'stepchild' },
  cs: { birth: 'vlastní dítě', adoptive: 'adoptované dítě', foster: 'dítě v pěstounské péči', step: 'nevlastní dítě' },
};

const CONFIDENCE_LABELS: Record<SummaryLanguage, Record<Confidence, string>> = {
  en: { very_low: 'very low', low: 'low', normal: 'normal', high: 'high', very_high: 'very high' },
  cs: { very_low: 'velmi nízká', low: 'nízká', normal: 'běžná', high: 'vysoká', very_high: 'velmi vysoká' },
};

const RECORD_LABELS: Record<SummaryLanguage, Record<SettableRecord, string>> = {
  en: { person: 'Person', name: 'Name', event: 'Event', role: 'Role', childLink: 'child link', source: 'Source', citation: 'Citation' },
  cs: { person: 'osoba', name: 'jméno', event: 'událost', role: 'role', childLink: 'vazba dítěte', source: 'pramen', citation: 'citace' },
};

const KIND_LABELS: Record<SummaryLanguage, Record<ImageKind, string>> = {
  en: { page: 'page image', photo: 'photo', portrait: 'portrait' },
  cs: { page: 'snímek stránky', photo: 'fotografie', portrait: 'portrét' },
};

/** Readable names of the settable fields. */
export const FIELD_LABELS: Record<SummaryLanguage, Record<string, string>> = {
  en: {
    sex: 'sex',
    given: 'given names',
    surname: 'surname',
    type: 'type',
    asFound: 'spelling as found',
    language: 'language',
    typeDetail: 'kind',
    date: 'date',
    placeId: 'Place',
    houseId: 'House',
    description: 'description',
    role: 'role',
    roleDetail: 'role detail',
    linkType: 'link type',
    title: 'title',
    repository: 'archive',
    reference: 'call number',
    url: 'link',
    page: 'page',
    transcription: 'transcription',
    readOn: 'read on',
    confidence: 'confidence',
    note: 'note',
  },
  cs: {
    sex: 'pohlaví',
    given: 'křestní jména',
    surname: 'příjmení',
    type: 'druh',
    asFound: 'zápis v prameni',
    language: 'jazyk',
    typeDetail: 'upřesnění',
    date: 'datum',
    placeId: 'místo',
    houseId: 'dům',
    description: 'popis',
    role: 'role',
    roleDetail: 'upřesnění role',
    linkType: 'druh vazby',
    title: 'název',
    repository: 'archiv',
    reference: 'signatura',
    url: 'odkaz',
    page: 'strana',
    transcription: 'přepis',
    readOn: 'přečteno',
    confidence: 'věrohodnost',
    note: 'poznámka',
  },
};

const quote = (s: string, language: SummaryLanguage) => (language === 'cs' ? `„${s}“` : `“${s}”`);
const nameOf = (n: { given: string; surname: string }) => `${n.given} ${n.surname}`.trim();

function fieldValue(value: unknown, language: SummaryLanguage, ctx: SummaryContext): string {
  if (value === null || value === undefined || value === '') return language === 'cs' ? '(prázdné)' : '(empty)';
  if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(value)) return ctx.label(value, language);
  const shown = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
  return quote(shown, language);
}

type Op<K extends Operation['op']> = Extract<Operation, { op: K }>;
/** What every sentence needs: the label of a referenced record, and the language. */
interface Say {
  L: (ref: string) => string;
  cs: boolean;
  language: SummaryLanguage;
  ctx: SummaryContext;
}

const typeOf = (op: { type: EventType; typeDetail: string | null }, language: SummaryLanguage) =>
  op.type === 'other' && op.typeDetail ? op.typeDetail : EVENT_TYPE_LABELS[language][op.type];

function addName(op: Op<'addName'>, { L, cs, language }: Say): string {
  return cs
    ? `přidává jméno ${quote(op.asFound, language)} (${nameKind(op, 'cs')}) osobě: ${L(op.personId)}`
    : `adds the Name ${quote(op.asFound, language)} (${nameKind(op, 'en')}) to ${L(op.personId)}`;
}

function addRole(op: Op<'addRole'>, { L, cs, language }: Say): string {
  const role = op.role === 'other' && op.roleDetail ? op.roleDetail : ROLE_LABELS[language][op.role];
  return cs ? `přidává roli ${role}: ${L(op.personId)} – ${L(op.eventId)}` : `adds ${role} ${L(op.personId)} to ${L(op.eventId)}`;
}

function attachCitation(op: Op<'attachCitation'>, { L, cs }: Say): string {
  const target = L(op.eventId ?? op.nameId ?? '');
  return cs ? `připojuje citaci ${L(op.citationId)} k: ${target}` : `cites ${L(op.citationId)} for ${target}`;
}

function createEvent(op: Op<'createEvent'>, { L, cs, language }: Say): string {
  const type = typeOf(op, language);
  const when = op.date ? (cs ? ` ${op.date}` : ` on ${op.date}`) : '';
  const where = op.placeId
    ? cs
      ? `, místo: ${L(op.placeId)}`
      : ` at ${L(op.placeId)}`
    : op.houseId
      ? cs
        ? `, dům: ${L(op.houseId)}`
        : ` at ${L(op.houseId)}`
      : '';
  return cs ? `přidává událost: ${type}${when}${where}` : `adds the ${type}${when}${where}`;
}

function createFamily(op: Op<'createFamily'>, { L, cs }: Say): string {
  const partners = [op.partner1Id, op.partner2Id].filter((p): p is string => p !== null).map(L);
  const list = partners.length ? partners.join(cs ? ' a ' : ' and ') : cs ? 'bez známých partnerů' : 'with no known partners';
  return cs ? `přidává rodinu: ${list}` : `adds the Family of ${list}`;
}

function createSource(op: Op<'createSource'>, { cs, language }: Say): string {
  if (op.familyAccount) {
    return cs
      ? `přidává rodinné vyprávění: ${quote(op.title, language)}, vyprávěl(a) ${op.familyAccount.givenBy}, ${op.familyAccount.givenOn}`
      : `adds the Family account ${quote(op.title, language)}, given by ${op.familyAccount.givenBy} in ${op.familyAccount.givenOn}`;
  }
  return cs ? `přidává pramen: ${quote(op.title, language)}` : `adds the Source ${quote(op.title, language)}`;
}

function createCitation(op: Op<'createCitation'>, { L, cs }: Say): string {
  const page = op.page ? (cs ? `, strana ${op.page}` : `, page ${op.page}`) : '';
  return cs
    ? `přidává citaci z pramene ${L(op.sourceId)}${page} (věrohodnost ${CONFIDENCE_LABELS.cs[op.confidence]})`
    : `adds a Citation of ${L(op.sourceId)}${page} (${CONFIDENCE_LABELS.en[op.confidence]} confidence)`;
}

function addImage(op: Op<'addImage'>, { L, cs }: Say): string {
  const of = op.kind === 'portrait' ? op.personIds.map(L).join(', ') : op.citationId ? L(op.citationId) : '';
  return cs ? `přidává ${KIND_LABELS.cs[op.kind]}: ${of}` : `adds a ${KIND_LABELS.en[op.kind]} to ${of}`;
}

function setField(op: Op<'setField'>, { L, cs, language, ctx }: Say): string {
  const changes = Object.entries(op.set).map(
    ([k, v]) => `${Object.hasOwn(FIELD_LABELS[language], k) ? FIELD_LABELS[language][k] : k} → ${fieldValue(v, language, ctx)}`,
  );
  return cs
    ? `mění (${RECORD_LABELS.cs[op.record]}) ${L(op.id)}: ${changes.join(', ')}`
    : `changes ${L(op.id)} (${RECORD_LABELS.en[op.record]}): ${changes.join(', ')}`;
}

function restoreRecord(op: Op<'restoreRecord'>, { L, cs }: Say): string {
  const what = op.table.replace(/_/g, ' ');
  if (op.values === null) return cs ? `odebírá záznam (${what}) ${L(op.id)}` : `removes the ${what} record ${L(op.id)}`;
  return cs ? `vrací záznam (${what}) ${L(op.id)} do dřívější podoby` : `restores the ${what} record ${L(op.id)} to its earlier state`;
}

function setFamilyRoot(op: Op<'setFamilyRoot'>, { L, cs }: Say): string {
  if (op.familyRoot) return cs ? `označuje osobu ${L(op.personId)} za kořen rodu` : `marks ${L(op.personId)} as a Family root`;
  return cs ? `ruší osobu ${L(op.personId)} jako kořen rodu` : `no longer marks ${L(op.personId)} as a Family root`;
}

/**
 * One readable sentence per operation, in Czech or English, for review and history
 * ("adds godparent Anna Králová to the baptism (1801-03-12)"). Czech sentences use the
 * "verb: object" form so that names need no declension.
 */
export function describeOperation(op: Operation, ctx: SummaryContext, language: SummaryLanguage): string {
  const say: Say = { L: (ref) => ctx.label(ref, language), cs: language === 'cs', language, ctx };
  const { L, cs } = say;
  switch (op.op) {
    case 'createPerson':
      return cs ? `přidává osobu: ${nameOf(op.name)}` : `adds the Person ${nameOf(op.name)}`;
    case 'addName':
      return addName(op, say);
    case 'createEvent':
      return createEvent(op, say);
    case 'addRole':
      return addRole(op, say);
    case 'createFamily':
      return createFamily(op, say);
    case 'linkChild':
      return cs
        ? `připojuje ${LINK_TYPE_LABELS.cs[op.linkType]}: ${L(op.childId)} (${L(op.familyId)})`
        : `links ${L(op.childId)} as ${LINK_TYPE_LABELS.en[op.linkType]} to ${L(op.familyId)}`;
    case 'createSource':
      return createSource(op, say);
    case 'createCitation':
      return createCitation(op, say);
    case 'attachCitation':
      return attachCitation(op, say);
    case 'addImage':
      return addImage(op, say);
    case 'setField':
      return setField(op, say);
    case 'mergePersons':
      return cs ? `slučuje osobu ${L(op.mergeId)} do osoby ${L(op.keepId)}` : `merges ${L(op.mergeId)} into ${L(op.keepId)}`;
    case 'restoreRecord':
      return restoreRecord(op, say);
    case 'setFamilyRoot':
      return setFamilyRoot(op, say);
  }
}

/** The label of a record created inside a Proposal, from the operation that creates it. */
function tempLabel(op: Operation, language: SummaryLanguage, ctx: SummaryContext): string | null {
  switch (op.op) {
    case 'createPerson':
      return nameOf(op.name);
    case 'addName':
      return op.tempId ? quote(op.asFound, language) : null;
    case 'createEvent': {
      const type = typeOf(op, language);
      return language === 'cs' ? (op.date ? `${type} ${op.date}` : type) : op.date ? `the ${type} of ${op.date}` : `the ${type}`;
    }
    case 'createFamily': {
      const partners = [op.partner1Id, op.partner2Id].filter((p): p is string => p !== null).map((p) => ctx.label(p, language));
      return language === 'cs' ? `rodina ${partners.join(' a ')}` : `the Family of ${partners.join(' and ')}`;
    }
    case 'createSource':
      return quote(op.title, language);
    case 'createCitation':
      return op.page ? `${ctx.label(op.sourceId, language)}, ${language === 'cs' ? 's.' : 'p.'} ${op.page}` : ctx.label(op.sourceId, language);
    default:
      return null;
  }
}

/** Labels for records created inside a Proposal, from the operations themselves. */
export function tempLabels(ops: readonly Operation[], language: SummaryLanguage, existing: SummaryContext): Map<string, string> {
  const out = new Map<string, string>();
  const ctx: SummaryContext = { label: (ref, lang) => out.get(ref) ?? existing.label(ref, lang) };
  for (const op of ops) {
    const label = tempLabel(op, language, ctx);
    if (label !== null && 'tempId' in op && op.tempId) out.set(op.tempId, label);
  }
  return out;
}

/** Sentences for every operation of a Proposal, in both languages. */
export function describeOperations(ops: readonly Operation[], existing: SummaryContext): Array<Record<SummaryLanguage, string>> {
  const contextFor = (lang: SummaryLanguage): SummaryContext => {
    const temps = tempLabels(ops, lang, existing);
    return { label: (ref, l) => temps.get(ref) ?? existing.label(ref, l) };
  };
  const cs = contextFor('cs');
  const en = contextFor('en');
  return ops.map((op) => ({ cs: describeOperation(op, cs, 'cs'), en: describeOperation(op, en, 'en') }));
}
