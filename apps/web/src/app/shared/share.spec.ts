import { linksFor, shareMedia, type ShareEnv, type SharedItem } from './share';

const item: SharedItem = {
  pageUrl: 'https://app.test/api/v1/public/share/m-1',
  url: 'https://files.test/m-1',
  contentType: 'image/jpeg',
  caption: 'Mermelada de ciruela',
  exhibitorName: 'Chacra El Origen',
};

const withoutNative: ShareEnv = {
  fetchFile: async () => null,
};

describe('linksFor', () => {
  it('builds WhatsApp and Facebook links with the text and the page, encoded', () => {
    const links = linksFor(item);
    expect(links.whatsapp).toBe(
      'https://wa.me/?text=' +
        encodeURIComponent('Mermelada de ciruela · Chacra El Origen — https://app.test/api/v1/public/share/m-1'),
    );
    expect(links.facebook).toBe(
      'https://www.facebook.com/sharer/sharer.php?u=' +
        encodeURIComponent('https://app.test/api/v1/public/share/m-1'),
    );
  });
});

describe('shareMedia', () => {
  it('uses the native menu with the file when the browser can share files', async () => {
    const shared: unknown[] = [];
    const env: ShareEnv = {
      share: async (data) => void shared.push(data),
      canShare: () => true,
      fetchFile: async () => new File(['x'], 'foto.jpg', { type: 'image/jpeg' }),
    };
    expect(await shareMedia(item, env)).toEqual({ kind: 'shared' });
    expect(shared).toEqual([
      expect.objectContaining({ url: item.pageUrl, files: [expect.any(File)] }),
    ]);
  });

  it('treats cancelling the native menu as nothing to report', async () => {
    const env: ShareEnv = {
      share: async () => {
        throw new DOMException('cancelled', 'AbortError');
      },
      canShare: () => true,
      fetchFile: async () => new File(['x'], 'foto.jpg', { type: 'image/jpeg' }),
    };
    expect(await shareMedia(item, env)).toEqual({ kind: 'cancelled' });
  });

  it('offers WhatsApp, Facebook, copy and download without a native menu, and not Instagram', async () => {
    const outcome = await shareMedia(item, withoutNative);
    expect(outcome.kind).toBe('options');
    if (outcome.kind !== 'options') return;
    expect(outcome.options.map((o) => o.id)).toEqual(['whatsapp', 'facebook', 'copy', 'download']);
    expect(outcome.options.find((o) => o.id === 'download')?.href).toBe(item.url);
  });

  it('falls back to the options when the file cannot be fetched for the native menu', async () => {
    const env: ShareEnv = {
      share: async () => undefined,
      canShare: () => true,
      fetchFile: async () => null,
    };
    expect((await shareMedia(item, env)).kind).toBe('options');
  });
});
