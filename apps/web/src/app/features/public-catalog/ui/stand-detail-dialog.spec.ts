import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { StandView } from '../domain/stand-filters';
import { StandDetailDialog } from './stand-detail-dialog';

const base: StandView = {
  id: 'es1',
  code: 'S1',
  status: 'OCCUPIED',
  sector: 'Diseño y moda',
  areaM2: 9,
  priceCents: 1_740_000,
  exhibitor: {
    name: 'Lanas del Limay',
    category: 'Textil de autor',
    description: 'Hilados con lana de la meseta.',
    photos: [],
    media: [],
  },
  points: '',
  x: 1,
  y: 1,
  w: 3,
  h: 3,
};

@Component({
  imports: [StandDetailDialog],
  template: `
    <button id="invoker" type="button">Stand S1</button>
    @if (open()) {
      <app-stand-detail-dialog [stand]="stand()" [plan]="[]" (closed)="open.set(false)" />
    }
  `,
})
class Host {
  readonly stand = signal<StandView>(base);
  readonly open = signal(true);
}

async function render(stand: StandView = base) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.stand.set(stand);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, dialog: () => host.querySelector('dialog') };
}

describe('StandDetailDialog', () => {
  it('shows the stand and the exhibitor, in a native labelled dialog', async () => {
    const { host, dialog } = await render();
    const el = dialog()!;
    expect(el.getAttribute('aria-labelledby')).toBe('stand-dialog-title');
    expect(el.getAttribute('role')).toBeNull();
    expect(el.hasAttribute('aria-modal')).toBe(false);
    const text = host.textContent ?? '';
    for (const expected of [
      'Stand S1',
      'Diseño y moda',
      '3 × 3 m',
      'Lanas del Limay',
      'Textil de autor',
      'Hilados con lana de la meseta.',
    ])
      expect(text).toContain(expected);
  });

  it('renders the photos as lazy, labelled images', async () => {
    const { host } = await render({
      ...base,
      exhibitor: {
        ...base.exhibitor!,
        photos: [
          { url: 'https://files.test/a', alt: 'Telar con lanas' },
          { url: 'https://files.test/b', alt: 'Ovillos de colores' },
        ],
      },
    });
    const images = [...host.querySelectorAll<HTMLImageElement>('dialog .gallery img')];
    expect(images.map((i) => i.alt)).toEqual(['Telar con lanas', 'Ovillos de colores']);
    expect(images.every((i) => i.getAttribute('loading') === 'lazy')).toBe(true);
    expect(host.querySelector('dialog .mini')).toBeNull();
  });

  it('falls back to the plan miniature when there are no photos', async () => {
    const { host } = await render();
    expect(host.querySelector('dialog .gallery')).toBeNull();
    expect(host.querySelector('dialog .mini svg')?.getAttribute('aria-label')).toContain(
      'Ubicación del stand S1',
    );
  });

  it('closes with the Close button and tells the parent', async () => {
    const { fixture, host } = await render();
    host.querySelector<HTMLButtonElement>('dialog .actions button')!.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(false);
    expect(host.querySelector('dialog')).toBeNull();
  });

  it('closes when the browser closes it (Esc) and tells the parent', async () => {
    const { fixture, dialog } = await render();
    dialog()!.dispatchEvent(new Event('close'));
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('puts the autofocus on the Close button', async () => {
    const { host } = await render();
    expect(host.querySelector('dialog .actions button')?.hasAttribute('autofocus')).toBe(true);
  });

  it('shows a video with controls, no autoplay, and its text', async () => {
    const withVideo: StandView = {
      ...base,
      exhibitor: {
        ...base.exhibitor!,
        media: [
          {
            id: 'm1',
            kind: 'VIDEO',
            url: 'https://files.test/m1',
            alt: '',
            caption: 'Así se hace',
            durationS: 45,
          },
        ],
      },
    };
    const { host } = await render(withVideo);
    const video = host.querySelector<HTMLVideoElement>('dialog video')!;
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(host.querySelector('dialog .gallery')?.textContent).toContain('Así se hace');
  });

  it('gives every image its caption as text alternative', async () => {
    const withImage: StandView = {
      ...base,
      exhibitor: {
        ...base.exhibitor!,
        media: [
          { id: 'm1', kind: 'IMAGE', url: 'https://files.test/m1', alt: '', caption: 'Mermelada', durationS: null },
        ],
      },
    };
    const { host } = await render(withImage);
    expect(host.querySelector<HTMLImageElement>('dialog .gallery img')?.alt).toBe('Mermelada');
  });

  const withPublication: StandView = {
    ...base,
    exhibitor: {
      ...base.exhibitor!,
      media: [
        { id: 'm1', kind: 'IMAGE', url: 'https://files.test/m1', alt: '', caption: 'Mermelada', durationS: null },
      ],
    },
  };

  it('offers a share button on each publication, and none on profile photos', async () => {
    const withPhoto: StandView = {
      ...withPublication,
      exhibitor: {
        ...withPublication.exhibitor!,
        photos: [{ url: 'https://files.test/p', alt: 'Telar' }],
      },
    };
    const { host } = await render(withPhoto);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('dialog .gallery button.share')];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('aria-label')).toContain('Mermelada');
  });

  it('without a native share menu, offers WhatsApp, Facebook, copy and download, but not Instagram', async () => {
    const { host, fixture } = await render(withPublication);
    host.querySelector<HTMLButtonElement>('dialog .gallery button.share')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    const menu = host.querySelector('dialog .share-menu')!;
    expect(menu.querySelector('a[href^="https://wa.me/"]')).not.toBeNull();
    expect(menu.querySelector('a[href^="https://www.facebook.com/sharer/"]')).not.toBeNull();
    expect(menu.textContent).toContain('Copiar link');
    expect(menu.querySelector('a[download]')).not.toBeNull();
    expect(menu.textContent).not.toContain('Instagram');
  });
});
