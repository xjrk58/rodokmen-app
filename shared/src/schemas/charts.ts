/**
 * Charts (tree-charts spec; GLOSSARY "Chart", "Descendant chart", "House chart", "Direct line",
 * "Sheet"): the queries of the two Chart routes and the Chart model they answer with.
 *
 * The model says which Persons, Families and rows a Chart holds, in what order, with which facts
 * and marks. It has no coordinates and no words in any language: the app lays it out and labels
 * it (design.md, "Select on the server, lay out and draw in the app"). Facts are data (Name
 * parts, EDTF dates, Place names as the Tree records them), so that the same model gives the
 * same Sheet in every Interface language.
 */
import { z } from 'zod';
import { RelationToFamily } from './api.js';
import { Id, IsoDay } from './common.js';
import { ChildLinkType, Sex } from './tree.js';

// ---------------------------------------------------------------- queries

/** How a Sheet treats Living people: absent for the screen, `reduced` or `nameless` for a Sheet. */
export const SheetVariant = z.enum(['reduced', 'nameless']).meta({
  id: 'SheetVariant',
  description:
    'Absent: the screen variant, as the tree shows the Tree. reduced: a Sheet, every Person an Export reduces kept to name, sex, relationships and birth year. nameless: a Sheet whose Living people are cards that say only that they are living',
});

const QueryBool = z.enum(['true', 'false']);

/** The options of a Descendant chart (tree-charts spec, "Descendant chart", "Direct line"). */
export const DescendantChartQuery = z
  .object({
    person: Id.optional().describe('Start at this Person: their descendants with every partner'),
    family: Id.optional().describe('Start at this Family: the couple and their descendants'),
    generations: z.coerce.number().int().min(2).max(8).default(4).describe('Generations in the tree form, the start counting as the first (2 to 8)'),
    form: z.enum(['tree', 'line']).default('tree').describe('tree: every branch; line: the Direct line down the centre'),
    line: Id.optional().describe('The end of the Direct line, a descendant of the start; needed for form=line'),
    sheet: SheetVariant.optional(),
  })
  .superRefine((q, ctx) => {
    if ((q.person === undefined) === (q.family === undefined)) ctx.addIssue({ code: 'custom', message: 'give either person or family', path: ['person'] });
    if (q.form === 'line' && q.line === undefined)
      ctx.addIssue({ code: 'custom', message: 'form=line needs line, the end of the Direct line', path: ['line'] });
  });

/** The options of a House chart (tree-charts spec, "House chart", "Size of a Chart"). */
export const HouseChartQuery = z
  .object({
    from: z.coerce.number().int().min(1).max(9999).optional().describe('Only rows whose period could reach this year or later'),
    to: z.coerce.number().int().min(1).max(9999).optional().describe('Only rows whose period could reach this year or earlier'),
    unrelated: QueryBool.default('false').describe('true: also the rows of Unrelated people'),
    sheet: SheetVariant.optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, { message: 'the period ends before it starts', path: ['to'] });

// ---------------------------------------------------------------- the model: cards

/** A fact on a card: an Event's type, date, and Place or House, as the Tree records them. */
export const ChartFact = z
  .object({
    eventId: Id,
    type: z.enum(['birth', 'baptism', 'death', 'burial', 'marriage']),
    date: z.string().nullable().describe('EDTF date as written; null when undated'),
    placeId: Id.nullable().describe("The Event's Place, or its House's Place"),
    place: z.string().nullable().describe("That Place's primary name"),
    houseId: Id.nullable(),
    houseNumber: z.string().nullable().describe('The house number the House had at the date of the Event, when known'),
  })
  .meta({ id: 'ChartFact' });

/** A Person's card: what the Tree records, and the marks (tree-charts spec, "What a card shows", "Marks on cards"). */
export const ChartPerson = z
  .object({
    id: Id,
    sex: Sex,
    given: z.string().describe('Given name of the primary Name; empty on a card without a name'),
    surname: z.string().describe('Surname of the primary Name; empty on a card without a name'),
    birthSurname: z.string().nullable().describe('The surname of the birth Name, when the primary Name is a married name with another surname'),
    living: z.boolean().describe('Living by the Living rule on livingOn'),
    relation: RelationToFamily,
    familyRoot: z.boolean(),
    born: ChartFact.nullable().describe('The birth, or else the baptism'),
    died: ChartFact.nullable().describe('The death, or else the burial'),
    birthYear: z.number().int().nullable().describe('The year of the earliest day the birth could be; null when unknown'),
    diedYoung: z.boolean().describe('The dates show for certain that the Person died before their 15th birthday'),
    reduced: z.boolean().describe('On a Sheet: reduced as in an Export (name, sex, relationships and birth year only)'),
    nameless: z.boolean().describe('On a Sheet without names: a Living person shown only as living'),
  })
  .meta({ id: 'ChartPerson' });

export const ChartChild = z
  .object({
    personId: Id,
    linkType: ChildLinkType.describe('birth and adoptive children are followed; foster and step children are shown, dashed, and not followed'),
    weakLink: z.boolean().describe('No Citation of normal or higher confidence supports the link: drawn dotted'),
  })
  .meta({ id: 'ChartChild' });

/** A Family on a Chart: its couple, marriage and children in the Chart's order. */
export const ChartFamily = z
  .object({
    id: Id,
    partner1Id: Id.nullable(),
    partner2Id: Id.nullable(),
    marriage: ChartFact.nullable(),
    weakLink: z.boolean().describe('No Citation of normal or higher confidence supports the partner link'),
    children: z
      .array(ChartChild)
      .describe("In the Chart's order: by the earliest day of birth or baptism, undated last, then as the Family records them, then by id"),
  })
  .meta({ id: 'ChartFamily' });

export const ChartSource = z.object({ id: Id, title: z.string() }).meta({ id: 'ChartSource' });

/** The state of the Tree a Chart shows: the newest accepted change. */
export const ChartAsOf = z
  .object({
    logEntryId: Id.nullable().describe('The newest log entry; null for an empty history'),
    acceptedAt: z.string().nullable().describe('When it was accepted (ISO timestamp)'),
  })
  .meta({ id: 'ChartAsOf' });

const ChartBase = {
  sheet: SheetVariant.nullable().describe('null: the screen variant'),
  asOf: ChartAsOf,
  livingOn: IsoDay.describe('The day the Living rule was applied'),
  persons: z.array(ChartPerson).describe('Every Person on the Chart, by id'),
  families: z.array(ChartFamily).describe('Every Family on the Chart, by id'),
  sources: z.array(ChartSource).describe('The Sources cited for the facts shown, by title in code units, then by id'),
};

// ---------------------------------------------------------------- Descendant chart

export const DescendantFamilyPlace = z
  .object({
    familyId: Id,
    partnerId: Id.nullable().describe("The descendant's partner in this Family"),
    pointer: z.boolean().describe('The Family is drawn at an earlier place of the Chart (descendants who married each other); this place points to it'),
    children: z.array(z.string()).describe("The keys of the children's nodes, in the Chart's order"),
  })
  .meta({ id: 'DescendantFamilyPlace' });

export const DescendantNode = z
  .object({
    key: z.string().describe('Unique within the Chart: the Person id, or <Person id>/<Family id> for a later place under that Family'),
    personId: Id,
    generation: z.number().int().min(1).describe('1 for the start; the smallest number of followed links from it, plus 1'),
    followed: z.boolean().describe('Reached by a birth or adoptive link (or the start); false for a foster or step child, who is not followed'),
    pointer: z.boolean().describe('A later place of a Person drawn earlier in the Chart: a card that points to the first place'),
    onLine: z.boolean().describe('On the Direct line'),
    leftOut: z.number().int().min(0).describe('Descendants left out below this Person to keep the Chart within 500 cards'),
    moreBelow: z.boolean().describe('The Person has descendants that the Chart does not show'),
    families: z.array(DescendantFamilyPlace).describe("The Person's Families as a partner, earlier marriage first"),
  })
  .meta({ id: 'DescendantNode' });

export const LineSibling = z
  .object({
    personId: Id,
    side: z.enum(['left', 'right']).describe('left: born before the next Person of the line; right: after'),
    families: z.array(z.object({ familyId: Id, partnerId: Id.nullable(), children: z.array(Id) })),
  })
  .meta({ id: 'LineSibling' });

export const LineRow = z
  .object({
    personId: Id.describe('The Person of the Direct line in this generation'),
    familyId: Id.nullable().describe('The line couple: the Family the next Person of the line descends from'),
    partnerId: Id.nullable(),
    children: z.array(ChartChild).describe("All the line couple's children, in the Chart's order"),
    nextId: Id.nullable().describe('The next Person of the line among the children; null in the last row'),
    siblings: z.array(LineSibling).describe('The married siblings of the next Person of the line, outward from the line on each side'),
  })
  .meta({ id: 'LineRow' });

export const DescendantChart = z
  .object({
    kind: z.literal('descendants'),
    form: z.enum(['tree', 'line']),
    start: z.object({ personId: Id.nullable(), familyId: Id.nullable() }).describe('The start as understood: a merged Person is followed to the kept one'),
    generations: z.number().int().describe('Generations asked for (tree form)'),
    shown: z.number().int().describe('Whole generations shown: fewer than asked when the Chart would hold more than 500 Person cards'),
    leftOut: z.number().int().min(0).describe('Descendants left out in all'),
    cards: z.number().int().min(0).describe('Person cards on the Chart: descendants, partners and pointer cards'),
    line: z.array(Id).describe('The Direct line from the start to its end, empty without one'),
    lineBeyond: z.boolean().describe('The Direct line goes deeper than the tree form shows'),
    nodes: z.array(DescendantNode).describe("Tree form: the descendants in the Chart's order, depth first; the first is the start"),
    rows: z.array(LineRow).describe('Line form: one row per generation of the Direct line'),
    ...ChartBase,
  })
  .meta({ id: 'DescendantChart' });

// ---------------------------------------------------------------- House chart

export const HouseRowLink = z
  .object({
    kind: z
      .enum(['son', 'daughter', 'child', 'remarriage', 'none'])
      .describe('How the row is linked to an earlier row by Family links; none: no link recorded'),
    rowKey: z.string().nullable().describe('The earlier row'),
    personId: Id.nullable().describe('The partner through whom the rows are linked'),
  })
  .meta({ id: 'HouseRowLink' });

export const HouseRow = z
  .object({
    key: z.string().describe('The Family id, or the Person id of a row of their own'),
    familyId: Id.nullable(),
    partner1Id: Id.nullable(),
    partner2Id: Id.nullable(),
    earliest: IsoDay.nullable().describe('The first day of the period at the House; null when undated or open'),
    latest: IsoDay.nullable().describe('The last day of the period at the House; null when undated or open'),
    dated: z.boolean().describe('false: no dated Event places the row at the House, and it comes last'),
    numbers: z.array(z.string()).describe("House numbers whose period overlaps the row's"),
    children: z.array(ChartChild.extend({ bornHere: z.boolean() })),
    diedHere: z.array(Id).describe('Persons of the row who died or were buried at the House'),
    link: HouseRowLink,
    marriedIn: Id.nullable().describe('The other partner, when they are a child of no earlier row'),
    unrelated: z.boolean().describe('Every Person of the row is Unrelated'),
  })
  .meta({ id: 'HouseRow' });

export const HouseChart = z
  .object({
    kind: z.literal('house'),
    house: z.object({
      id: Id,
      placeId: Id,
      place: z.string().nullable(),
      numbers: z.array(z.object({ number: z.string(), from: z.string().nullable(), to: z.string().nullable() })).describe('House numbers with their periods'),
    }),
    from: z.number().int().nullable(),
    to: z.number().int().nullable(),
    unrelated: z.boolean(),
    firstYear: z.number().int().nullable().describe('The first year of the dated rows, for choosing a period'),
    lastYear: z.number().int().nullable(),
    total: z.number().int().describe('Rows in the period, before the limit of 80'),
    hiddenUnrelated: z.number().int().describe('Rows of Unrelated people left out'),
    needsPeriod: z.boolean().describe('More than 80 rows: choose a period (from, to); rows is then empty'),
    rows: z.array(HouseRow).describe('In order: by the earliest day of their Events at the House, undated rows last, then by key'),
    ...ChartBase,
  })
  .meta({ id: 'HouseChart' });

export type DescendantChartQuery = z.infer<typeof DescendantChartQuery>;
export type HouseChartQuery = z.infer<typeof HouseChartQuery>;
export type ChartFact = z.infer<typeof ChartFact>;
export type ChartPerson = z.infer<typeof ChartPerson>;
export type ChartChild = z.infer<typeof ChartChild>;
export type ChartFamily = z.infer<typeof ChartFamily>;
export type ChartSource = z.infer<typeof ChartSource>;
export type DescendantNode = z.infer<typeof DescendantNode>;
export type LineRow = z.infer<typeof LineRow>;
export type LineSibling = z.infer<typeof LineSibling>;
export type DescendantChart = z.infer<typeof DescendantChart>;
export type HouseRow = z.infer<typeof HouseRow>;
export type HouseChart = z.infer<typeof HouseChart>;
