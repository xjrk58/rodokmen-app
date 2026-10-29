/**
 * Search normalisation shared by app and server: lower case, no diacritics.
 * Matches PostgreSQL's `lower(unaccent(...))` for the letters used in Czech, German and Latin.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
