const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export type CsvValue = string | number | null;

/**
 * One CSV cell. Text starting with a spreadsheet formula trigger gets a leading single quote
 * (CSV injection); numbers are trusted, so a negative amount stays numeric.
 */
export function csvCell(value: CsvValue): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  const safe = FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** RFC 4180 rows with CRLF, behind a UTF-8 BOM so Excel reads the accents. */
export function csvDocument(
  header: readonly string[],
  rows: readonly (readonly CsvValue[])[],
): string {
  const line = (cells: readonly CsvValue[]) =>
    `${cells.map(csvCell).join(',')}\r\n`;
  return `﻿${line(header)}${rows.map(line).join('')}`;
}
