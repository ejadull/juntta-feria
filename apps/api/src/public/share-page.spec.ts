import { renderSharePage, type SharePageInput } from './share-page.js';

const base: SharePageInput = {
  title: 'Mermelada de ciruela · Chacra El Origen · Ritual Cipolletti 2026',
  description: 'Mermelada de ciruela hecha en la chacra.',
  pageUrl: 'https://app.test/api/v1/public/share/m-1',
  redirectUrl: 'https://app.test/ferias/ritual-cipolletti-2026?publicacion=m-1',
  image: { url: 'https://cdn.test/foto.jpg?sig=1', type: 'image/jpeg' },
  video: null,
};

describe('renderSharePage', () => {
  it('describes an image with Open Graph and Twitter tags', () => {
    const html = renderSharePage(base);
    expect(html).toContain('<meta property="og:title" content="Mermelada de ciruela · Chacra El Origen · Ritual Cipolletti 2026">');
    expect(html).toContain('<meta property="og:description" content="Mermelada de ciruela hecha en la chacra.">');
    expect(html).toContain('<meta property="og:image" content="https://cdn.test/foto.jpg?sig=1">');
    expect(html).toContain('<meta property="og:url" content="https://app.test/api/v1/public/share/m-1">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).not.toContain('og:video');
  });

  it('describes a video without an image when there is no poster', () => {
    const html = renderSharePage({
      ...base,
      image: null,
      video: { url: 'https://cdn.test/v.mp4?sig=2', type: 'video/mp4' },
    });
    expect(html).toContain('<meta property="og:video" content="https://cdn.test/v.mp4?sig=2">');
    expect(html).toContain('<meta property="og:video:type" content="video/mp4">');
    expect(html).not.toContain('og:image');
  });

  it('sends the visitor on to the fair, with a link as fallback', () => {
    const html = renderSharePage(base);
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=https://app.test/ferias/ritual-cipolletti-2026?publicacion=m-1">');
    expect(html).toContain('href="https://app.test/ferias/ritual-cipolletti-2026?publicacion=m-1"');
  });

  it('escapes text so a caption cannot inject markup', () => {
    const html = renderSharePage({
      ...base,
      title: '</title><script>alert(1)</script>',
      description: `"><img src=x onerror=alert(1)>`,
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img');
  });
});
