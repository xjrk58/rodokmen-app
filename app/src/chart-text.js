// The words of a Chart in the reader's Interface language (tree-charts spec, "Labels in the
// reader's language"): dates by fixed patterns from the chart.* texts, counts by fixed plural
// rules, house numbers, titles, the legend and the colophon. Nothing here asks the device's
// locale (no Intl, no toLocale*String), so two devices write the same words. Names, Place names
// and Source titles stay as the Tree records them.

/** @typedef {Record<string, string>} Strings */
/** @typedef {import('./types.js').ChartPerson} ChartPerson */

/**
 * The plural category of a whole number, as CLDR gives it for integers: Czech and Slovak have
 * one (1), few (2 to 4) and other; English and German one (1) and other.
 * @param {string} lang
 * @param {number} n
 * @returns {'one' | 'few' | 'other'}
 */
export function pluralOf(lang, n) {
  if (n === 1) return 'one';
  if ((lang === 'cs' || lang === 'sk') && n >= 2 && n <= 4) return 'few';
  return 'other';
}

/**
 * A date in the EDTF subset, read only far enough to write it (the shared parser decides what is valid).
 * @param {string} edtf
 * @returns {{ form: 'day' | 'month' | 'year' | 'about' | 'uncertain' | 'between' | 'before' | 'after', parts: string[] } | null}
 */
export function dateParts(edtf) {
  let m;
  if ((m = /^\.\.\/(.+)$/.exec(edtf))) return { form: 'before', parts: [m[1]] };
  if ((m = /^(.+)\/\.\.$/.exec(edtf))) return { form: 'after', parts: [m[1]] };
  if ((m = /^([^/]+)\/([^/]+)$/.exec(edtf))) return { form: 'between', parts: [m[1], m[2]] };
  if ((m = /^(.+)~$/.exec(edtf))) return { form: 'about', parts: [m[1]] };
  if ((m = /^(.+)\?$/.exec(edtf))) return { form: 'uncertain', parts: [m[1]] };
  if (/^\d{4}-\d{2}-\d{2}$/.test(edtf)) return { form: 'day', parts: [edtf] };
  if (/^\d{4}-\d{2}$/.test(edtf)) return { form: 'month', parts: [edtf] };
  if (/^\d{4}$/.test(edtf)) return { form: 'year', parts: [edtf] };
  return null;
}

/**
 * The labels of a Chart in one language.
 * @param {Strings} strings the chart.* texts (app/i18n/<lang>.json)
 * @param {string} lang
 */
export function chartLabels(strings, lang) {
  /**
   * @param {string} key
   * @param {Record<string, string | number>} [params]
   */
  const t = (key, params = {}) =>
    (strings[key] ?? key).replace(/\{(\w+)\}/g, (/** @type {string} */ match, /** @type {string} */ name) => (name in params ? String(params[name]) : match));

  /** A plain day, month or year. @param {string} part */
  const simple = (part) => {
    const [y, mo, d] = part.split('-');
    if (d !== undefined) return t('chart.date.day', { d: Number(d), monthOf: t(`chart.monthOf.${Number(mo)}`), y: Number(y) });
    if (mo !== undefined) return t('chart.date.month', { month: t(`chart.month.${Number(mo)}`), y: Number(y) });
    return String(Number(y));
  };

  /** A date as the Sheet writes it. @param {string | null} edtf */
  const date = (edtf) => {
    if (edtf === null) return '';
    const p = dateParts(edtf);
    if (p === null) return edtf;
    switch (p.form) {
      case 'about':
        return t('chart.date.about', { date: simple(p.parts[0]) });
      case 'uncertain':
        return t('chart.date.uncertain', { date: simple(p.parts[0]) });
      case 'between':
        return t('chart.date.between', { from: simple(p.parts[0]), to: simple(p.parts[1]) });
      case 'before':
        return t('chart.date.before', { date: simple(p.parts[0]) });
      case 'after':
        return t('chart.date.after', { date: simple(p.parts[0]) });
      default:
        return simple(p.parts[0]);
    }
  };

  /** The year of a date for life years: the first year written. @param {string | null} edtf */
  const year = (edtf) => (edtf === null ? '' : (/\d{4}/.exec(edtf)?.[0] ?? ''));

  /** @param {string} number */
  const houseNumber = (number) => t('chart.houseNumber', { n: number });

  /** Where a fact took place: the Place, and the house number of that date. @param {import('./types.js').ChartFact} f */
  const place = (f) => [f.place ?? '', f.houseNumber === null ? '' : houseNumber(f.houseNumber)].filter(Boolean).join(' ');

  /** A fact's line after its symbol: date and Place. @param {import('./types.js').ChartFact | null} f */
  const fact = (f) => (f === null ? '' : [date(f.date), place(f)].filter(Boolean).join(' '));

  /** The name on a card, with the birth surname of a married name. @param {ChartPerson} p */
  const name = (p) => {
    if (p.nameless) return t('chart.living');
    const full = `${p.given} ${p.surname}`.trim() || t('chart.unnamed');
    return p.birthSurname ? `${full} ${t('chart.bornSurname', { surname: p.birthSurname })}` : full;
  };

  /** Life years, such as "1801–1850" or "* 2010". @param {ChartPerson} p */
  const lifeYears = (p) => {
    const born = p.born ? year(p.born.date) : p.birthYear === null ? '' : String(p.birthYear);
    const died = p.died ? year(p.died.date) : '';
    if (born && died) return `${born}–${died}`;
    if (born) return `* ${born}`;
    return died ? `† ${died}` : '';
  };

  /** A count with the plural form of its language. @param {string} key @param {number} n */
  const count = (key, n) => t(`${key}.${pluralOf(lang, n)}`, { n });

  return { lang, t, date, year, place, fact, name, lifeYears, count, houseNumber };
}

/** @typedef {ReturnType<typeof chartLabels>} ChartLabels */

/**
 * The default title of a Chart, with no grammatical case to get wrong: the names in the nominative.
 * @param {ChartLabels} labels
 * @param {import('./types.js').DescendantChart | import('./types.js').HouseChart} model
 */
export function defaultTitle(labels, model) {
  const person = (/** @type {string | null} */ id) => model.persons.find((p) => p.id === id);
  if (model.kind === 'house') {
    const numbers = model.house.numbers.map((n) => {
      const span =
        n.from && n.to
          ? `${labels.year(n.from)}–${labels.year(n.to)}`
          : n.from
            ? labels.t('chart.from', { y: labels.year(n.from) })
            : n.to
              ? labels.t('chart.until', { y: labels.year(n.to) })
              : '';
      return span ? `${labels.houseNumber(n.number)} (${span})` : labels.houseNumber(n.number);
    });
    return labels.t('chart.title.house', { place: model.house.place ?? '', numbers: numbers.join(', ') });
  }
  const first = model.nodes[0] ?? null;
  const rootId = model.form === 'line' ? (model.rows[0]?.personId ?? null) : (first?.personId ?? null);
  const root = person(rootId);
  const partnerId = model.form === 'line' ? (model.rows[0]?.partnerId ?? null) : model.start.familyId !== null ? (first?.families[0]?.partnerId ?? null) : null;
  const partner = person(partnerId);
  const names = [root, partner].filter((p) => p !== undefined).map((p) => labels.name(/** @type {ChartPerson} */ (p)));
  return labels.t(names.length > 1 ? 'chart.title.couple' : 'chart.title.person', { a: names[0] ?? '', b: names[1] ?? '' });
}
