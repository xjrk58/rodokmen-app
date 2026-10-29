// A small RFC 4180 CSV reader: comma separated, optional double quotes, first row is the header.

/**
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const records = [];
  /** @type {string[]} */
  let record = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      field = '';
      if (record.length > 1 || record[0] !== '') records.push(record);
      record = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  const [header, ...rows] = records;
  return rows.map((row, n) => {
    if (row.length !== header.length) throw new Error(`CSV row ${n + 2} has ${row.length} fields, expected ${header.length}`);
    return Object.fromEntries(header.map((h, i) => [h, row[i]]));
  });
}
