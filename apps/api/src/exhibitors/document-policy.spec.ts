import {
  deriveDocumentsStatus,
  documentKey,
  MAX_DOCUMENT_BYTES,
} from './document-policy.js';

const T = 'abababab-abab-4bab-8bab-abababababab';
const E = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const D = 'efefefef-efef-4fef-8fef-efefefefefef';

describe('documentKey (EXH-03)', () => {
  it('nests the key under the tenant and the exhibitor', () => {
    expect(documentKey(T, E, D)).toBe(
      `tenants/${T}/exhibitors/${E}/documents/${D}`,
    );
  });

  it.each([
    ['tenant', ['../x', E, D]],
    ['exhibitor', [T, 'a/b', D]],
    ['document', [T, E, '']],
  ] as const)('rejects a %s part that is not a UUID', (_name, parts) => {
    expect(() => documentKey(parts[0], parts[1], parts[2])).toThrow(/UUID/);
  });

  it('caps uploads at 10 MiB', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('deriveDocumentsStatus', () => {
  it.each([
    [[], 'MISSING'],
    [['PENDING'], 'PENDING'],
    [['APPROVED'], 'APPROVED'],
    [['APPROVED', 'APPROVED'], 'APPROVED'],
    [['APPROVED', 'PENDING'], 'PENDING'],
    [['PENDING', 'REJECTED', 'APPROVED'], 'REJECTED'],
  ] as const)('%j -> %s', (statuses, expected) => {
    expect(deriveDocumentsStatus(statuses)).toBe(expected);
  });
});
