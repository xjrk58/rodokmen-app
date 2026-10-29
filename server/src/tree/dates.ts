import { parseEdtf, type Period } from '@rodokmen/shared';

/** Storage of an EDTF-subset date: as written, plus earliest/latest days (open ends as ±infinity). */
export function dateColumns(date: string | null): { date: string | null; date_earliest: string | null; date_latest: string | null } {
  if (date === null) return { date: null, date_earliest: null, date_latest: null };
  const parsed = parseEdtf(date);
  return { date, date_earliest: parsed.earliest ?? '-infinity', date_latest: parsed.latest ?? 'infinity' };
}

/** Storage of a Period: ends as written, plus valid_from/valid_to days. */
export function periodColumns(period: Period): { period_from: string | null; period_to: string | null; valid_from: string; valid_to: string } {
  return {
    period_from: period.from,
    period_to: period.to,
    valid_from: period.from === null ? '-infinity' : (parseEdtf(period.from).earliest ?? '-infinity'),
    valid_to: period.to === null ? 'infinity' : (parseEdtf(period.to).latest ?? 'infinity'),
  };
}

/** Converts a stored day back to the API form: open ends become null. */
export function dayOrNull(day: string | null): string | null {
  return day === null || day === 'infinity' || day === '-infinity' ? null : day;
}

export function periodOf(row: { period_from: string | null; period_to: string | null }): Period {
  return { from: row.period_from, to: row.period_to };
}
