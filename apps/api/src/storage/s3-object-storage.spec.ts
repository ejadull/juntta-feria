import { contentDisposition, S3ObjectStorage } from './s3-object-storage.js';

const settings = {
  endpoint: 'http://s3:4566',
  publicEndpoint: 'http://localhost:4566',
  region: 'us-east-1',
  bucket: 'unit-bucket',
  accessKey: 'test',
  secretKey: 'test-secret',
  forcePathStyle: true,
};

describe('S3ObjectStorage presigning (EXH-03)', () => {
  const storage = new S3ObjectStorage(settings);
  const key = 'tenants/t/exhibitors/e/documents/d';

  it('signs uploads for the public endpoint, with type and length in the signature', async () => {
    const { url, headers } = await storage.presignUpload({
      key,
      contentType: 'application/pdf',
      sizeBytes: 1234,
      expiresInSeconds: 300,
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('http://localhost:4566');
    expect(parsed.pathname).toBe(`/unit-bucket/${key}`);
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('300');
    const signed = parsed.searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signed).toContain('content-length');
    expect(signed).toContain('content-type');
    expect(headers).toEqual({ 'Content-Type': 'application/pdf' });
  });

  it('signs downloads as attachments with a short expiry', async () => {
    const url = new URL(
      await storage.presignDownload({
        key,
        fileName: 'Constancia "AFIP".pdf',
        contentType: 'application/pdf',
        expiresInSeconds: 60,
      }),
    );
    expect(url.origin).toBe('http://localhost:4566');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(url.searchParams.get('response-content-disposition')).toContain(
      'attachment',
    );
  });
});

describe('contentDisposition', () => {
  it('removes quotes, separators and control characters from the file name', () => {
    const header = contentDisposition('..\\a/"b"\n.pdf');
    expect(header).toMatch(/^attachment; filename="[^"\\/\n]*"; filename\*=/);
  });

  it('keeps accents in the UTF-8 name and an ASCII fallback', () => {
    const header = contentDisposition('Habilitación.pdf');
    expect(header).toContain('filename="Habilitaci_n.pdf"');
    expect(header).toContain("UTF-8''Habilitaci%C3%B3n.pdf");
  });

  it('falls back to a generic name when nothing is left', () => {
    expect(contentDisposition('   ')).toContain('filename="documento"');
  });
});
