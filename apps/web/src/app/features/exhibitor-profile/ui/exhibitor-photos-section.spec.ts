import { TestBed } from '@angular/core/testing';
import { FileUploader } from '../../documents/data/document.repository';
import { InMemoryFileUploader } from '../../documents/data/in-memory-documents.repository';
import {
  ExhibitorPhotosRepository,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  type ExhibitorPhotoDto,
} from '../data/exhibitor-photos.repository';
import { InMemoryExhibitorPhotosRepository } from '../data/in-memory-exhibitor-photos.repository';
import { ExhibitorPhotosSection } from './exhibitor-photos-section';

const photo = (n: number): ExhibitorPhotoDto => ({
  id: `p${n}`,
  status: 'READY',
  contentType: 'image/jpeg',
  sizeBytes: 1000,
  alt: n === 1 ? 'Telar con lanas' : null,
  position: n,
  url: `https://files.test/p${n}`,
});

const image = (name = 'a.jpg', type = 'image/jpeg', size = 2048) =>
  new File([new Uint8Array(size)], name, { type });

async function render(seed: readonly ExhibitorPhotoDto[] = [], isPublic = true) {
  const repo = new InMemoryExhibitorPhotosRepository(seed);
  const uploader = new InMemoryFileUploader();
  TestBed.configureTestingModule({
    providers: [
      { provide: ExhibitorPhotosRepository, useValue: repo },
      { provide: FileUploader, useValue: uploader },
    ],
  });
  const fixture = TestBed.createComponent(ExhibitorPhotosSection);
  fixture.componentRef.setInput('isPublic', isPublic);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const choose = async (...files: File[]) => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  return { host, repo, uploader, choose, fixture };
}

describe('ExhibitorPhotosSection', () => {
  it('lists the photos with alt text, lazy loading and the count', async () => {
    const { host } = await render([photo(1), photo(2)]);
    const images = [...host.querySelectorAll('img')];
    expect(images.map((i) => i.alt)).toEqual(['Telar con lanas', 'Foto 2 de tu stand']);
    expect(images.every((i) => i.getAttribute('loading') === 'lazy')).toBe(true);
    expect(host.querySelector('[data-testid="photo-count"]')?.textContent).toContain(
      `2 de ${MAX_PHOTOS}`,
    );
  });

  it('only accepts jpeg, png and webp in the picker', async () => {
    const { host } = await render();
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe('image/jpeg,image/png,image/webp');
    expect(input.multiple).toBe(true);
  });

  it('uploads straight to storage then confirms, and shows the new photo', async () => {
    const { host, repo, uploader, choose } = await render();
    await choose(image('stand.jpg'));
    expect(uploader.sent).toHaveLength(1);
    expect(repo.all()).toHaveLength(1);
    expect(host.querySelectorAll('img')).toHaveLength(1);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Subimos la foto');
  });

  it('rejects a wrong type or an oversized file next to the control, without uploading', async () => {
    const { host, uploader, choose } = await render();
    await choose(
      image('doc.pdf', 'application/pdf'),
      image('big.png', 'image/png', MAX_PHOTO_BYTES + 1),
    );
    expect(uploader.sent).toHaveLength(0);
    const alert = host.querySelector('#photos-error');
    expect(alert?.textContent).toContain('doc.pdf');
    expect(alert?.textContent).toContain('big.png');
    expect(host.querySelector('input[type="file"]')?.getAttribute('aria-describedby')).toBe(
      'photos-error',
    );
  });

  it('stops at the limit of six photos', async () => {
    const { host } = await render(Array.from({ length: MAX_PHOTOS }, (_, i) => photo(i + 1)));
    expect(host.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true);
    expect(host.textContent).toContain(`máximo de ${MAX_PHOTOS} fotos`);
  });

  it('removes a photo', async () => {
    const { host, repo, fixture } = await render([photo(1), photo(2)]);
    host.querySelector<HTMLButtonElement>('button[aria-label="Eliminar foto 1"]')!.click();
    await fixture.whenStable();
    expect(repo.all().map((p) => p.id)).toEqual(['p2']);
    expect(host.querySelectorAll('img')).toHaveLength(1);
  });

  it('warns that photos are not public without the directory consent', async () => {
    const withConsent = await render([], true);
    expect(withConsent.host.querySelector('[data-testid="photos-private"]')).toBeNull();
    TestBed.resetTestingModule();
    const without = await render([], false);
    expect(without.host.querySelector('[data-testid="photos-private"]')).not.toBeNull();
  });
});
