/**
 * Sentences for the operations on Places, Houses, Parishes and Estates, and on research notes
 * and Labels, in Czech and English (see proposal-summaries.ts).
 */
import type { PlaceOrNoteOperation } from './place-operations.js';
import { PLACE_TYPE_LABELS, quote, RECORD_LABELS, type Op, type Say } from './summary-parts.js';

const periodText = (p: { from: string | null; to: string | null }) => (p.from || p.to ? ` (${p.from ?? '…'}–${p.to ?? '…'})` : '');

function placeOps(
  op: Op<'createPlace' | 'addPlaceName' | 'createHouse' | 'addHouseNumber' | 'createParish' | 'createEstate'>,
  { L, cs, language }: Say,
): string {
  switch (op.op) {
    case 'createPlace':
      return cs ? `přidává místo: ${op.name.name} (${PLACE_TYPE_LABELS.cs[op.type]})` : `adds the Place ${op.name.name} (${PLACE_TYPE_LABELS.en[op.type]})`;
    case 'addPlaceName':
      return cs
        ? `přidává název ${quote(op.name, language)} (${op.language})${periodText(op.period)} místu: ${L(op.placeId)}`
        : `adds the name ${quote(op.name, language)} (${op.language})${periodText(op.period)} to ${L(op.placeId)}`;
    case 'createHouse': {
      const numbers = op.numbers.map((n) => `${n.number}${periodText(n.period)}`).join(', ');
      return cs ? `přidává dům: ${L(op.placeId)} čp. ${numbers || '?'}` : `adds the House ${L(op.placeId)} No. ${numbers || '?'}`;
    }
    case 'addHouseNumber':
      return cs
        ? `přidává číslo popisné ${op.number}${periodText(op.period)} domu: ${L(op.houseId)}`
        : `adds the house number ${op.number}${periodText(op.period)} to ${L(op.houseId)}`;
    case 'createParish':
      return cs ? `přidává farnost: ${op.name}` : `adds the Parish ${op.name}`;
    case 'createEstate':
      return cs ? `přidává panství: ${op.name}` : `adds the Estate ${op.name}`;
  }
}

function linkPlace(op: Op<'linkPlaceParish' | 'linkPlaceEstate'>, { L, cs }: Say): string {
  const to = op.op === 'linkPlaceParish' ? op.parishId : op.estateId;
  if (op.op === 'linkPlaceParish')
    return cs
      ? `řadí místo ${L(op.placeId)} k farnosti ${L(to)}${periodText(op.period)}`
      : `puts ${L(op.placeId)} in the Parish ${L(to)}${periodText(op.period)}`;
  return cs ? `řadí místo ${L(op.placeId)} k panství ${L(to)}${periodText(op.period)}` : `puts ${L(op.placeId)} in the Estate ${L(to)}${periodText(op.period)}`;
}

function notesAndLabels(op: Op<'setNotes' | 'addLabel' | 'removeLabel'>, { L, cs, language }: Say): string {
  if (op.op === 'addLabel')
    return cs ? `přidává štítek ${quote(op.label, language)} osobě: ${L(op.personId)}` : `labels ${L(op.personId)} ${quote(op.label, language)}`;
  if (op.op === 'removeLabel')
    return cs ? `odebírá štítek ${quote(op.label, language)} osobě: ${L(op.personId)}` : `takes the Label ${quote(op.label, language)} off ${L(op.personId)}`;
  const record = RECORD_LABELS[language][op.record];
  if (op.notes === null || op.notes.trim() === '')
    return cs ? `odebírá badatelské poznámky (${record}): ${L(op.id)}` : `removes the research notes of ${L(op.id)} (${record})`;
  const first = op.notes.trim().split('\n')[0]!;
  const shown = first.length > 80 ? `${first.slice(0, 79)}…` : first;
  return cs
    ? `zapisuje badatelské poznámky (${record}) ${L(op.id)}: ${quote(shown, language)}`
    : `writes research notes on ${L(op.id)} (${record}): ${quote(shown, language)}`;
}

/** The sentence of one of these operations. */
export function describePlaceOrNote(op: PlaceOrNoteOperation, say: Say): string {
  switch (op.op) {
    case 'createPlace':
    case 'addPlaceName':
    case 'createHouse':
    case 'addHouseNumber':
    case 'createParish':
    case 'createEstate':
      return placeOps(op, say);
    case 'linkPlaceParish':
    case 'linkPlaceEstate':
      return linkPlace(op, say);
    case 'setNotes':
    case 'addLabel':
    case 'removeLabel':
      return notesAndLabels(op, say);
  }
}
