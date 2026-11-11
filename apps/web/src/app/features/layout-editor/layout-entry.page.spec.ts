import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { EventsRepository, type OrganizerEvent } from '../../shared/events/events.repository';
import { LayoutEntryPage } from './layout-entry.page';

const event = (id: string, status: OrganizerEvent['status'], startsAt: string): OrganizerEvent => ({
  id,
  name: id,
  status,
  startsAt,
  layoutVersionId: `lv-${id}`,
});

async function render(list: EventsRepository['list']) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'organizador/layouts/:versionId/editor', children: [] }]),
      { provide: EventsRepository, useValue: { list } },
    ],
  });
  const fixture = TestBed.createComponent(LayoutEntryPage);
  await fixture.whenStable();
  return { host: fixture.nativeElement as HTMLElement, router: TestBed.inject(Router) };
}

describe('LayoutEntryPage', () => {
  it('redirects to the editor of the current event layout version', async () => {
    const { router } = await render(() =>
      of([
        event('old', 'CLOSED', '2025-01-01T00:00:00Z'),
        event('cur', 'PUBLISHED', '2026-11-20T13:00:00Z'),
      ]),
    );
    expect(router.url).toBe('/organizador/layouts/lv-cur/editor');
  });

  it('explains there is no plan yet when the organization has no events', async () => {
    const { host, router } = await render(() => of([]));
    expect(router.url).toBe('/');
    expect(host.querySelector('[data-testid="no-layout"]')?.textContent).toContain(
      'Todavía no hay un plano para editar',
    );
    expect(host.querySelector('a[href="/organizador/panel"]')).not.toBeNull();
  });

  it('shows an alert when the events cannot be loaded', async () => {
    const { host } = await render(() => throwError(() => new Error('offline')));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No pudimos cargar');
  });
});
