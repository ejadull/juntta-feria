import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { signedInAs } from '../../shared/auth/testing';
import type { MembershipRole } from '../../shared/auth/session.store';
import { InMemoryOrganizerReservationsRepository } from './data/in-memory-organizer-reservations.repository';
import { OrganizerReservationsRepository } from './data/organizer-reservations.repository';
import { OrganizerReservationsPage } from './organizer-reservations.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const problem = (status: number, code?: string) =>
  new HttpErrorResponse({ status, error: code ? { code } : {} });

async function render(
  role: MembershipRole = 'OWNER',
  repo: OrganizerReservationsRepository = new InMemoryOrganizerReservationsRepository(),
) {
  TestBed.configureTestingModule({
    providers: [{ provide: OrganizerReservationsRepository, useValue: repo }, signedInAs(role)],
  });
  const fixture = TestBed.createComponent(OrganizerReservationsPage);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find((b) => plain(b.textContent).startsWith(name));
  const click = async (name: string) => {
    const target = button(name);
    expect(target, `button "${name}"`).toBeTruthy();
    target!.click();
    await fixture.whenStable();
  };
  const rows = () => [...host.querySelectorAll('[data-testid="reservation"]')];
  return { fixture, host, button, click, rows, repo };
}

describe('OrganizerReservationsPage (P09, RES-01, PAY-06)', () => {
  it('lists the reservations of the latest event in an accessible table', async () => {
    const { host, rows } = await render();
    expect(plain(host.querySelector('h1')?.textContent)).toBe('Reservas y cobros');
    expect(plain(host.querySelector('caption')?.textContent)).toBe(
      'Reservas del evento Feria de demostración',
    );
    const headers = [...host.querySelectorAll('thead th')];
    expect(headers.every((h) => h.getAttribute('scope') === 'col')).toBe(true);
    expect(rows()).toHaveLength(4);
    const first = plain(rows()[0].textContent);
    expect(first).toContain('S1');
    expect(first).toContain('Feriante S1');
    expect(first).toContain('s1@example.test');
    expect(first).toMatch(/\$\s?17\.400/);
    expect(first).toContain('Retenida');
    expect(first).toContain('Vence');
    expect(rows()[0].querySelector('th')?.getAttribute('scope')).toBe('row');
    expect(plain(rows()[2].textContent)).toContain('Aprobado');
  });

  it('counts by status in filter chips and filters by one', async () => {
    const { host, click, rows } = await render();
    const chips = [...host.querySelectorAll('[aria-label="Filtrar por estado"] button')];
    expect(chips.map((c) => plain(c.textContent))).toEqual([
      'Todas (4)',
      expect.stringContaining('Retenida (1)'),
      expect.stringContaining('Pago pendiente (1)'),
      expect.stringContaining('Confirmada (1)'),
      expect.stringContaining('Vencida (1)'),
    ]);
    await click('◔');
    expect(rows()).toHaveLength(1);
    expect(plain(rows()[0].textContent)).toContain('S1');
    expect(chips[1].getAttribute('aria-pressed')).toBe('true');
    await click('Todas');
    expect(rows()).toHaveLength(4);
  });

  it('cancels a live hold after an in-page confirmation, focusing the safe choice', async () => {
    const { host, click, rows, repo } = await render();
    const cancel = vi.spyOn(repo, 'cancel');
    await click('Cancelar');
    const dialog = host.querySelector('[role="alertdialog"]')!;
    expect(plain(dialog.textContent)).toContain('¿Cancelar la reserva?');
    expect(plain(dialog.textContent)).toContain('Stand S1');
    expect(document.activeElement?.textContent?.trim()).toBe('No, volver');
    expect(cancel).not.toHaveBeenCalled();

    await click('Sí, cancelar reserva');
    expect(cancel).toHaveBeenCalledWith('r1');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(plain(host.querySelector('[role="status"]')?.textContent)).toContain(
      'Reserva cancelada',
    );
    expect(plain(rows()[0].textContent)).toContain('Cancelada');
  });

  it('refunds a confirmed reservation with the amount of a partial refund and a per-action key', async () => {
    const { host, click, fixture, repo } = await render();
    const refund = vi.spyOn(repo, 'refund');
    await click('Devolver pago');
    const input = host.querySelector<HTMLInputElement>('#amount')!;
    input.value = '99999';
    input.dispatchEvent(new Event('input'));
    await click('Sí, devolver');
    expect(refund).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toContain(
      'no puede superar',
    );

    input.value = '1.000,50';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    await click('Sí, devolver');
    expect(refund).toHaveBeenCalledTimes(1);
    const [id, key, cents] = refund.mock.calls[0];
    expect([id, cents]).toEqual(['r3', 100_050]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refunds in full when the amount is left empty', async () => {
    const { click, repo } = await render();
    const refund = vi.spyOn(repo, 'refund');
    await click('Devolver pago');
    await click('Sí, devolver');
    expect(refund.mock.calls[0][2]).toBeUndefined();
  });

  it('cancels a pending payment through the refund endpoint', async () => {
    const { click, repo, rows } = await render();
    const refund = vi.spyOn(repo, 'refund');
    await click('Cancelar cobro');
    await click('Sí, cancelar cobro');
    expect(refund.mock.calls[0][0]).toBe('r2');
    expect(plain(rows()[1].textContent)).toContain('Cancelada');
  });

  it('explains a problem code in Spanish and keeps the confirmation open to retry', async () => {
    const repo = new InMemoryOrganizerReservationsRepository();
    repo.refund = () => throwError(() => problem(422, 'REFUND_WINDOW_CLOSED'));
    const { host, click } = await render('OWNER', repo);
    await click('Devolver pago');
    await click('Sí, devolver');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('180 días');
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it('lets an operator release holds but not touch money or see incidents', async () => {
    const repo = new InMemoryOrganizerReservationsRepository();
    const incidents = vi.spyOn(repo, 'incidents');
    const { host, button } = await render('OPERATOR', repo);
    expect(button('Cancelar')).toBeTruthy();
    expect(button('Devolver pago')).toBeUndefined();
    expect(button('Cancelar cobro')).toBeUndefined();
    expect(incidents).not.toHaveBeenCalled();
    expect(host.textContent).toContain('solo quienes administran');
  });

  it('shows payment incidents and refunds from one', async () => {
    const { host, click, repo, fixture } = await render();
    const refund = vi.spyOn(repo, 'refund');
    const item = host.querySelector('[data-testid="incident"]')!;
    expect(plain(item.textContent)).toContain('Pago tardío');
    expect(plain(item.textContent)).toContain('Stand S4');
    (item.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    await click('Sí, devolver');
    expect(refund.mock.calls[0][0]).toBe('r4');
  });

  it('says so when there are no incidents, and when they could not load', async () => {
    const none = new InMemoryOrganizerReservationsRepository();
    none.incidents = () => of([]);
    expect(plain((await render('OWNER', none)).host.textContent)).toContain(
      'No hay incidencias de pago',
    );
    TestBed.resetTestingModule();
    const broken = new InMemoryOrganizerReservationsRepository();
    broken.incidents = () => throwError(() => problem(500));
    expect(plain((await render('OWNER', broken)).host.textContent)).toContain(
      'No pudimos cargar las incidencias',
    );
  });

  it('shows empty states for no events and for an event without reservations', async () => {
    const noEvents = new InMemoryOrganizerReservationsRepository();
    noEvents.events = () => of([]);
    expect(plain((await render('OWNER', noEvents)).host.textContent)).toContain(
      'Todavía no hay eventos a la venta',
    );
    TestBed.resetTestingModule();
    const noRows = new InMemoryOrganizerReservationsRepository();
    noRows.reservations = () => of([]);
    expect(plain((await render('OWNER', noRows)).host.textContent)).toContain(
      'Todavía no hay reservas en este evento',
    );
  });

  it('offers only events on sale and picks the most recent', async () => {
    const repo = new InMemoryOrganizerReservationsRepository();
    const day = (n: number) => new Date(Date.UTC(2026, 10, n)).toISOString();
    repo.events = () =>
      of([
        { id: 'old', name: 'Vieja', status: 'ACTIVE', startsAt: day(1) },
        { id: 'draft', name: 'Borrador', status: 'DRAFT', startsAt: day(30) },
        { id: 'new', name: 'Nueva', status: 'PUBLISHED', startsAt: day(20) },
      ]);
    const reservations = vi.spyOn(repo, 'reservations');
    const { host } = await render('OWNER', repo);
    const options = [...host.querySelectorAll('#event option')].map((o) => plain(o.textContent));
    expect(options).toEqual(['Nueva', 'Vieja']);
    expect(reservations).toHaveBeenCalledWith('new');
  });

  it('refreshes on demand', async () => {
    const repo = new InMemoryOrganizerReservationsRepository();
    const events = vi.spyOn(repo, 'events');
    const { click } = await render('OWNER', repo);
    await click('Actualizar');
    expect(events).toHaveBeenCalledTimes(2);
  });

  it('shows a load error', async () => {
    const failing = new InMemoryOrganizerReservationsRepository();
    failing.reservations = () => throwError(() => problem(500));
    const { host } = await render('OWNER', failing);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No pudimos cargar');
  });
});
