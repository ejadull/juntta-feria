import { csvCell, csvDocument } from './csv.js';

describe('csvCell', () => {
  it('leaves plain text untouched and renders null as empty', () => {
    expect(csvCell('Ana')).toBe('Ana');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
  });

  it('quotes cells with separators, quotes or line breaks, doubling quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('di "hola"')).toBe('"di ""hola"""');
    expect(csvCell('uno\ndos')).toBe('"uno\ndos"');
  });

  it.each(['=1+1', '+cmd', '-2', '@SUM(A1)', '\tx', '\rx'])(
    'neutralizes the formula trigger %j with a leading single quote',
    (value) => {
      expect(csvCell(value).replace(/^"|"$/g, '')).toMatch(/^'/);
    },
  );

  it('does not touch negative numbers passed as numbers', () => {
    expect(csvCell(-5)).toBe('-5');
  });
});

describe('csvDocument', () => {
  it('starts with a UTF-8 BOM and ends rows with CRLF', () => {
    const out = csvDocument(['a', 'b'], [['1', 'ñ']]);
    expect(out).toBe('﻿a,b\r\n1,ñ\r\n');
  });
});
