import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import type { OrganizerEvent } from '../../../shared/events/events.repository';
import { InMemoryLayoutTemplatesRepository } from '../../layout-editor/data/in-memory-layout-templates.repository';
import {
  LayoutTemplatesRepository,
  type LayoutTemplateDto,
} from '../../layout-editor/data/layout-templates.repository';
import { InMemoryPaymentAccountRepository } from '../../payment-account/data/in-memory-payment-account.repository';
import { PaymentAccountRepository } from '../../payment-account/data/payment-account.repository';
import { InMemoryVenueRepository } from '../../venues/data/in-memory-venue.repository';
import { VenueRepository, type VenueDto } from '../../venues/data/venue.repository';
import { SetupChecklist } from './setup-checklist';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const VENUE: VenueDto = {
  id: 'v1',
  type: 'FIXED',
  name: 'Espacio Duam',
  address: null,
  timezone: 'America/Argentina/Buenos_Aires',
  widthM: 40,
  heightM: 25,
};
const PUBLISHED_PLAN: LayoutTemplateDto = {
  id: 't1',
  name: 'Salón',
  venueId: 'v1',
  versions: [{ id: 'lv1', version: 1, status: 'PUBLISHED', publishedAt: '2026-10-01T12:00:00Z' }],
};
const EVENT: OrganizerEvent = {
  id: 'e1',
  name: 'Feria',
  status: 'PUBLISHED',
  startsAt: '2026-11-20T13:00:00Z',
  layoutVersionId: 'lv1',
};

async function render(
  events: readonly OrganizerEvent[],
  {
    venues = new InMemoryVenueRepository(),
    templates = new InMemoryLayoutTemplatesRepository(),
    account = new InMemoryPaymentAccountRepository(),
  }: {
    venues?: VenueRepository;
    templates?: LayoutTemplatesRepository;
    account?: PaymentAccountRepository;
  } = {},
) {
  TestBed.configureTestingModule({
    providers: [
      { provide: VenueRepository, useValue: venues },
      { provide: LayoutTemplatesRepository, useValue: templates },
      { provide: PaymentAccountRepository, useValue: account },
      provideRouter([]),
    ],
  });
  const fixture = TestBed.createComponent(SetupChecklist);
  fixture.componentRef.setInput('events', events);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const steps = () =>
    [...host.querySelectorAll('[data-testid="setup-step"]')].map((s) => plain(s.textContent));
  return { host, steps };
}

describe('SetupChecklist (Primeros pasos)', () => {
  it('lists the four steps as pending, each with the screen that does it', async () => {
    const { steps, host } = await render([]);
    expect(steps()).toHaveLength(4);
    expect(steps().every((s) => s.includes('Pendiente'))).toBe(true);
    const hrefs = [...host.querySelectorAll('li a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/organizador/mercado-pago',
      '/organizador/predios?nuevo=1',
      '/organizador/plano',
      '/organizador/eventos?nuevo=1',
    ]);
  });

  it('marks as done what the organization already has, with text and not only color', async () => {
    const account = new InMemoryPaymentAccountRepository();
    await new Promise<void>((resolve) =>
      account.completeLink('c', 'demo-state').subscribe({ complete: resolve }),
    );
    const { steps } = await render([EVENT], {
      venues: new InMemoryVenueRepository([VENUE]),
      templates: new InMemoryLayoutTemplatesRepository([PUBLISHED_PLAN]),
      account,
    });
    expect(steps().every((s) => s.includes('Hecho'))).toBe(true);
  });

  it('keeps a draft event as pending: it only counts once published', async () => {
    const { steps } = await render([{ ...EVENT, status: 'DRAFT' }], {
      venues: new InMemoryVenueRepository([VENUE]),
    });
    expect(steps()[1]).toContain('Hecho');
    expect(steps()[3]).toContain('Pendiente');
  });

  it('does not count a draft-only plan as published', async () => {
    const draftOnly: LayoutTemplateDto = {
      ...PUBLISHED_PLAN,
      versions: [{ id: 'lv9', version: 1, status: 'DRAFT', publishedAt: null }],
    };
    const { steps } = await render([], {
      templates: new InMemoryLayoutTemplatesRepository([draftOnly]),
    });
    expect(steps()[2]).toContain('Pendiente');
  });

  it('shows a step as pending, never as done, when its check fails', async () => {
    const venues = new InMemoryVenueRepository([VENUE]);
    venues.list = () => throwError(() => new Error('offline'));
    const { steps } = await render([], { venues });
    expect(steps()[1]).toContain('Pendiente');
    expect(steps()).toHaveLength(4);
  });
});
