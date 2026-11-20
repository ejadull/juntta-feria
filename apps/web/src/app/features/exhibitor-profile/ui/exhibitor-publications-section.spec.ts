import { TestBed } from '@angular/core/testing';
import { FileUploader } from '../../documents/data/document.repository';
import { InMemoryFileUploader } from '../../documents/data/in-memory-documents.repository';
import {
  ExhibitorPhotosRepository,
  type ExhibitorPhotoDto,
} from '../data/exhibitor-photos.repository';
import { InMemoryExhibitorPhotosRepository } from '../data/in-memory-exhibitor-photos.repository';
import { ExhibitorPublicationsSection } from './exhibitor-publications-section';

const EVENT_A = { id: 'ev-a', name: 'Ritual 30/11' };
const EVENT_B = { id: 'ev-b', name: 'Ritual 15/12' };

const publication = (
  n: number,
  eventId: string,
  patch: Partial<ExhibitorPhotoDto> = {},
): ExhibitorPhotoDto => ({
  id: `pub-${n}`,
  status: 'READY',
  kind: 'IMAGE',
  contentType: 'image/jpeg',
  sizeBytes: 1000,
  alt: null,
  caption: `Mermelada ${n}`,
  durationS: null,
  eventId,
  position: n,
  url: `https://files.test/pub-${n}`,
  ...patch,
});

const image = (name = 'a.jpg', type = 'image/jpeg', size = 2048) =>
  new File([new Uint8Array(size)], name, { type });

async function render(
  seed: readonly ExhibitorPhotoDto[] = [],
  events: readonly { id: string; name: string }[] = [EVENT_A, EVENT_B],
) {
  const repo = new InMemoryExhibitorPhotosRepository(seed, events);
  const uploader = new InMemoryFileUploader();
  TestBed.configureTestingModule({
    providers: [
      { provide: ExhibitorPhotosRepository, useValue: repo },
      { provide: FileUploader, useValue: uploader },
    ],
  });
  const fixture = TestBed.createComponent(ExhibitorPublicationsSection);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const pick = async (eventId: string) => {
    const select = host.querySelector<HTMLSelectElement>('#pub-event')!;
    select.value = eventId;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  const choose = async (...files: File[]) => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  return { host, repo, choose, pick, fixture };
}

describe('ExhibitorPublicationsSection', () => {
  it('offers the events where the exhibitor holds a stand and shows only the selected event', async () => {
    const { host, pick } = await render([publication(1, 'ev-a'), publication(2, 'ev-b')]);
    const options = [...host.querySelectorAll<HTMLOptionElement>('#pub-event option')].map((o) =>
      o.textContent?.trim(),
    );
    expect(options).toEqual(['Ritual 30/11', 'Ritual 15/12']);
    await pick('ev-a');
    const text = [...host.querySelectorAll('[data-testid="pub-item"]')]
      .map((li) => li.textContent)
      .join(' ');
    expect(text).toContain('Mermelada 1');
    expect(text).not.toContain('Mermelada 2');
  });

  it('explains there is nothing to publish when the exhibitor holds no confirmed stand', async () => {
    const { host } = await render([], []);
    expect(host.querySelector('[data-testid="pub-no-events"]')?.textContent).toContain(
      'stand confirmado',
    );
    expect(host.querySelector('input[type="file"]')).toBeNull();
  });

  it('refuses a file the API would reject, without uploading it', async () => {
    const { host, repo, choose, pick } = await render([], [EVENT_A]);
    await pick('ev-a');
    await choose(image('clip.mov', 'video/quicktime', 4096));
    expect(host.querySelector('[data-testid="pub-error"]')?.textContent).toContain(
      'MP4 H.264 o un WebM',
    );
    expect(repo.all()).toHaveLength(0);
  });

  it('uploads an image to the selected event with its text, and lists it as ready', async () => {
    const { host, repo, choose, pick } = await render([], [EVENT_A]);
    await pick('ev-a');
    const caption = host.querySelector<HTMLInputElement>('#pub-caption')!;
    caption.value = 'Mermelada de ciruela';
    caption.dispatchEvent(new Event('input'));
    await choose(image('frasco.jpg'));
    expect(repo.all()).toEqual([
      expect.objectContaining({
        kind: 'IMAGE',
        eventId: 'ev-a',
        caption: 'Mermelada de ciruela',
        status: 'READY',
      }),
    ]);
    expect(host.querySelector('[data-testid="pub-item"]')?.textContent).toContain(
      'Mermelada de ciruela',
    );
  });

  it('stops publishing once the event has 10 publications', async () => {
    const seed = Array.from({ length: 10 }, (_, i) => publication(i + 1, 'ev-a'));
    const { host, choose, pick } = await render(seed, [EVENT_A]);
    await pick('ev-a');
    expect(host.querySelector('[data-testid="pub-count"]')?.textContent).toContain('10 de 10');
    expect((host.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true);
    await choose(image());
    expect(host.querySelectorAll('[data-testid="pub-item"]')).toHaveLength(10);
  });

  it('edits the text of a publication and deletes one', async () => {
    const { host, repo, pick, fixture } = await render([publication(1, 'ev-a')], [EVENT_A]);
    await pick('ev-a');
    const edit = host.querySelector<HTMLInputElement>(
      '[data-testid="pub-item"] input[type="text"]',
    )!;
    edit.value = 'Texto nuevo';
    edit.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="pub-save"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(repo.all()[0].caption).toBe('Texto nuevo');

    (host.querySelector('[data-testid="pub-delete"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(repo.all()).toHaveLength(0);
  });

  it('marks a publication the organizer hid', async () => {
    const { host, pick } = await render(
      [publication(1, 'ev-a', { status: 'HIDDEN' })],
      [EVENT_A],
    );
    await pick('ev-a');
    expect(host.querySelector('[data-testid="pub-hidden"]')?.textContent).toContain(
      'Oculta por el organizador',
    );
  });
});
