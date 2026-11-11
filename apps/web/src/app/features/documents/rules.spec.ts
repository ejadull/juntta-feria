import { fileProblem, formatBytes, MAX_DOCUMENT_BYTES } from './rules';

const file = (patch: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: 'constancia.pdf',
  type: 'application/pdf',
  size: 2048,
  ...patch,
});

describe('fileProblem (EXH-03)', () => {
  it('accepts a PDF, a JPG and a PNG up to the limit', () => {
    expect(fileProblem(file())).toBeNull();
    expect(fileProblem(file({ type: 'image/jpeg' }))).toBeNull();
    expect(fileProblem(file({ type: 'image/png', size: MAX_DOCUMENT_BYTES }))).toBeNull();
  });

  it('rejects other types, in Spanish', () => {
    expect(fileProblem(file({ type: 'text/html' }))).toBe(
      'Solo se aceptan archivos PDF, JPG o PNG.',
    );
    expect(fileProblem(file({ type: '' }))).toContain('PDF, JPG o PNG');
  });

  it('rejects an empty file and one over 10 MB, saying the sizes', () => {
    expect(fileProblem(file({ size: 0 }))).toBe('El archivo está vacío.');
    const big = fileProblem(file({ size: MAX_DOCUMENT_BYTES + 1 }));
    expect(big).toContain('el máximo es 10 MB');
  });
});

describe('formatBytes', () => {
  it('uses B, KB and MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });
});
