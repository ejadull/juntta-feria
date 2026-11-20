import { TestBed } from '@angular/core/testing';
import {
  EventPublicationsRepository,
  type EventPublicationDto,
} from '../data/event-publications.repository';
import { InMemoryEventPublicationsRepository } from '../data/in-memory-event-publications.repository';
import { EventPublicationsPanel } from './event-publications-panel';

const PUBLICATIONS: EventPublicationDto[] = [
  {
    id: 'p1',
    status: 'READY',
    kind: 'VIDEO',
    caption: 'Así se tiñe la lana',
    durationS: 45,
    exhibitorName: 'Chacra El Origen',
    url: 'https://files.test/p1',
  },
  {
    id: 'p2',
    status: 'HIDDEN',
    kind: 'IMAGE',
    caption: 'Mermelada',
    durationS: null,
    exhibitorName: 'Quesería Ventimiglia',
    url: 'https://files.test/p2',
  },
];

async function render(repo = new InMemoryEventPublicationsRepository(PUBLICATIONS)) {
  TestBed.configureTestingModule({
    providers: [{ provide: EventPublicationsRepository, useValue: repo }],
  });
  const fixture = TestBed.createComponent(EventPublicationsPanel);
  fixture.componentRef.setInput('eventId', 'e1');
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, repo };
}

describe('EventPublicationsPanel', () => {
  it('lists the publications of the event with their exhibitor and status', async () => {
    const { host } = await render();
    const items = [...host.querySelectorAll('[data-testid="pub-row"]')];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Chacra El Origen');
    expect(items[0].textContent).toContain('Publicada');
    expect(items[1].textContent).toContain('Oculta');
  });

  it('hides a published publication and shows it again', async () => {
    const { host, fixture, repo } = await render();
    host.querySelector<HTMLButtonElement>('[data-testid="pub-row"] button')!.click();
    await fixture.whenStable();
    expect(repo.hidden('p1')).toBe(true);
    expect(host.querySelector('[data-testid="pub-row"]')?.textContent).toContain('Oculta');

    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="pub-row"] button')];
    buttons[0].click();
    await fixture.whenStable();
    expect(repo.hidden('p1')).toBe(false);
  });

  it('explains when the event has no publications yet', async () => {
    const { host } = await render(new InMemoryEventPublicationsRepository([]));
    expect(host.querySelector('[data-testid="pub-empty"]')?.textContent).toContain(
      'Todavía no hay publicaciones',
    );
  });

  it('says what went wrong when a change is refused', async () => {
    const repo = new InMemoryEventPublicationsRepository(PUBLICATIONS);
    repo.failWith = { status: 409, error: { code: 'NOT_PUBLISHED' } };
    const { host, fixture } = await render(repo);
    host.querySelector<HTMLButtonElement>('[data-testid="pub-row"] button')!.click();
    await fixture.whenStable();
    expect(host.querySelector('[data-testid="pub-error"]')?.textContent).toContain(
      'No pudimos cambiar la publicación',
    );
  });
});
