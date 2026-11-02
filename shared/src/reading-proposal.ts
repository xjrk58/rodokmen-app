/**
 * A Proposal from a reading, for an Agent (scan-reading spec, "Agents can request a reading"):
 * the operations that add what the reading found, and the "read by AI" marks of every value
 * the reader produced. The Agent chooses, for each read person, an existing Person or a new one;
 * nobody is created without that choice ("Names are matched, not duplicated").
 *
 * The app builds the same Proposal on the device from the Member's check (app/src/reading-draft.js),
 * where marks clear as the Member confirms or corrects values; an Agent confirms nothing, so all
 * of its values stay marked.
 *
 * One Citation per page: the page's transcription with its image (ADR 0002: a Citation carries
 * an image of the page), attached to the Event of every entry read from that page.
 */
import type { OperationInput } from './schemas/proposals.js';
import { nameTypeForLanguage, type ReaderMark, type ReadEntry, type ReadingResult, type ReadPerson } from './schemas/reading.js';

export type ReadingSourceChoice = { sourceId: string } | { title: string; repository?: string | null; reference?: string | null; url?: string | null };

export interface ReadingProposalInput {
  result: ReadingResult;
  /** The uploads read, by page. */
  uploadIds: readonly string[];
  /** For each entry, the House that carried its number then, when the Tree has it (the reading view's `houses`). */
  houses?: ReadonlyArray<string | null>;
  /** For each read person by key: the id of an existing Person, or "new". */
  persons: Readonly<Record<string, string>>;
  source: ReadingSourceChoice;
  page: string | null;
  placeId: string | null;
  /** ISO day the pages were read. */
  readOn: string;
  /** The archive viewer address of the page, kept in the Citation's note. */
  link?: string | null;
  /** Entries to leave out, by index. */
  skip?: readonly number[];
}

export interface ReadingProposal {
  operations: OperationInput[];
  marks: ReaderMark[];
}

/** Read persons that have no choice yet: an existing Person or "new" (none is created unasked). */
export function unchosenPersons(result: ReadingResult, persons: Readonly<Record<string, string>>, skip: readonly number[] = []): string[] {
  return result.entries.flatMap((e, i) => (skip.includes(i) ? [] : e.persons.filter((p) => !persons[p.key]).map((p) => p.key)));
}

const BIRTH = new Set(['baptism', 'birth']);

/** The operations and marks of a Proposal from a reading. Throws when a read person has no choice. */
export function readingOperations(input: ReadingProposalInput): ReadingProposal {
  const skip = input.skip ?? [];
  const missing = unchosenPersons(input.result, input.persons, skip);
  if (missing.length) throw new Error(`choose an existing Person or "new" for ${missing.join(', ')}`);
  const ops: OperationInput[] = [];
  const marks: ReaderMark[] = [];
  const push = (op: OperationInput, marked: string[] = []) => {
    if (marked.length) marks.push({ position: ops.length, fields: marked });
    ops.push(op);
  };

  let sourceId: string;
  if ('sourceId' in input.source) sourceId = input.source.sourceId;
  else {
    sourceId = 'tmp:source';
    push({
      op: 'createSource',
      tempId: sourceId,
      type: 'parish_register',
      title: input.source.title,
      repository: input.source.repository ?? null,
      reference: input.source.reference ?? null,
      url: input.source.url ?? null,
    });
  }

  const included = input.result.entries.map((e, i) => ({ e, i })).filter(({ i }) => !skip.includes(i));
  const pages = [...new Set(included.map(({ e }) => e.page))].sort((a, b) => a - b);
  const citationOf = new Map<number, string>();
  for (const page of pages) {
    const read = input.result.pages[page];
    const text =
      read?.transcription.trim() ||
      included
        .filter(({ e }) => e.page === page)
        .map(({ e }) => e.transcription)
        .join('\n\n');
    const citationId = `tmp:citation${page + 1}`;
    citationOf.set(page, citationId);
    const pageLabel = input.page && pages.length > 1 ? `${input.page} (${page + 1})` : input.page;
    push(
      {
        op: 'createCitation',
        tempId: citationId,
        sourceId,
        page: pageLabel,
        transcription: text,
        readOn: input.readOn,
        confidence: 'normal',
        note: input.link ? `Online: ${input.link}` : null,
      },
      ['transcription'],
    );
    const uploadId = input.uploadIds[page];
    if (uploadId) push({ op: 'addImage', uploadId, kind: 'page', citationId });
  }

  for (const { e, i } of included) entryOperations(e, i, input, citationOf.get(e.page)!, push);
  return { operations: ops, marks };
}

type Push = (op: OperationInput, marked?: string[]) => void;

/** A new Person from a read person: the first name as primary, further forms as Names. */
function newPerson(p: ReadPerson, personId: string, push: Push): void {
  const [first, ...more] = p.names;
  if (!first) throw new Error(`${p.key} has no name`);
  const given = first.given.trim();
  const surname = first.surname.trim();
  push(
    {
      op: 'createPerson',
      tempId: personId,
      sex: p.sex,
      // A name read only as a whole keeps it as written, rather than a guessed split.
      name: { given: given || surname ? given : first.asWritten, surname, type: nameTypeForLanguage(first.language), asFound: first.asWritten },
    },
    ['sex', 'name.given', 'name.surname', 'name.asFound'],
  );
  more.forEach((m, j) => {
    if (!m.given.trim() && !m.surname.trim()) return;
    push(
      {
        op: 'addName',
        tempId: `tmp:${p.key}n${j + 2}`,
        personId,
        given: m.given.trim(),
        surname: m.surname.trim(),
        type: nameTypeForLanguage(m.language),
        asFound: m.asWritten,
      },
      ['given', 'surname', 'asFound'],
    );
  });
}

/**
 * The Family of an entry: the parents' of a baptism or birth, the partners' of a marriage, as a new
 * Family when at least one of them is new. Two existing Persons may have their Family already;
 * the Agent links to it on its own.
 */
function familyOperations(e: ReadEntry, n: number, ids: ReadonlyMap<string, string>, isNew: (key: string | undefined) => boolean, push: Push): void {
  const keyOf = (role: string) => e.persons.find((p) => p.role === role)?.key;
  const idOf = (key: string | undefined) => (key === undefined ? null : (ids.get(key) ?? null));
  const familyId = `tmp:f${n}`;
  if (BIRTH.has(e.type)) {
    const [child, father, mother] = [keyOf('child'), keyOf('father'), keyOf('mother')];
    const childId = idOf(child);
    if (childId === null || (father === undefined && mother === undefined)) return;
    if (father !== undefined && mother !== undefined && !isNew(father) && !isNew(mother)) return;
    push({ op: 'createFamily', tempId: familyId, partner1Id: idOf(father), partner2Id: idOf(mother) });
    push({ op: 'linkChild', familyId, childId, linkType: 'birth' });
  } else if (e.type === 'marriage') {
    const partners = e.persons.filter((p) => p.role === 'partner').map((p) => p.key);
    if (partners.length === 2 && partners.some(isNew))
      push({ op: 'createFamily', tempId: familyId, partner1Id: idOf(partners[0]), partner2Id: idOf(partners[1]) });
  }
}

function entryOperations(e: ReadEntry, index: number, input: ReadingProposalInput, citationId: string, push: Push) {
  const n = index + 1;
  const eventId = `tmp:e${n}`;
  const houseId = input.houses?.[index] ?? null;
  const description = e.house && !houseId ? `čp. ${e.house}` : null;
  const marked = ['type', 'date', ...(e.typeDetail ? ['typeDetail'] : []), ...(description ? ['description'] : [])];
  const typeDetail = e.type === 'other' ? e.typeDetail || 'entry' : e.typeDetail;
  push({ op: 'createEvent', tempId: eventId, type: e.type, typeDetail, date: e.date, placeId: houseId ? null : input.placeId, houseId, description }, marked);
  const ids = new Map<string, string>();
  for (const p of e.persons) {
    const choice = input.persons[p.key] ?? 'new';
    const personId = choice === 'new' ? `tmp:${p.key}` : choice;
    if (choice === 'new') newPerson(p, personId, push);
    ids.set(p.key, personId);
    push({ op: 'addRole', eventId, personId, role: p.role, roleDetail: p.roleDetail }, ['role', ...(p.roleDetail ? ['roleDetail'] : [])]);
  }
  familyOperations(e, n, ids, (key) => key !== undefined && input.persons[key] === 'new', push);
  push({ op: 'attachCitation', citationId, eventId });
}
