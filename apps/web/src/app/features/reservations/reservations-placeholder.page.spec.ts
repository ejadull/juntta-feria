import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ReservationsPlaceholderPage } from './reservations-placeholder.page';

describe('ReservationsPlaceholderPage (spec: "Marcador")', () => {
  it('explains the dependency on RES-01 and PAY-01 and shows no reservations', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ReservationsPlaceholderPage);
    const inputs = {
      eyebrow: 'ORGANIZADOR',
      heading: 'Reservas y cobros',
      intro: 'Va a mostrar las reservas del evento.',
      backLink: '/organizador/panel',
      backLabel: 'Volver al panel',
    };
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('h1')?.textContent).toContain('Reservas y cobros');
    expect(host.textContent).toContain('RES-01');
    expect(host.textContent).toContain('PAY-01');
    expect(host.querySelector('table, ul li')).toBeNull();
    expect(host.textContent).not.toMatch(/\$\s?\d/); // no simulated amounts
  });
});
