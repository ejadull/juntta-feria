import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EventMetricsRepository } from './data/event-metrics.repository';
import { InMemoryEventMetricsRepository } from './data/in-memory-event-metrics.repository';
import { DashboardPage } from './dashboard.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function render(repo = new InMemoryEventMetricsRepository()) {
  TestBed.configureTestingModule({
    providers: [{ provide: EventMetricsRepository, useValue: repo }, provideRouter([])],
  });
  const fixture = TestBed.createComponent(DashboardPage);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const kpi = (label: string) =>
    plain(
      [...host.querySelectorAll('app-kpi-card')].find((k) => k.textContent?.includes(label))
        ?.textContent,
    );
  return { host, kpi };
}

describe('DashboardPage (P03)', () => {
  it('shows the event, its dates and the demo-data label', async () => {
    const { host } = await render();
    expect(plain(host.querySelector('h1')?.textContent)).toBe('Panel del evento');
    expect(plain(host.textContent)).toContain('Patagonia Emprende 2026');
    expect(plain(host.textContent)).toContain('20–22 nov · Espacio Duam, Neuquén');
    expect(host.textContent).toContain('Datos de demostración');
  });

  it('shows the four KPIs with their explanation', async () => {
    const { kpi } = await render();
    expect(kpi('Stands comercializables')).toContain('40');
    expect(kpi('Stands comercializables')).toContain('2 bloqueados');
    expect(kpi('Ocupación')).toContain('58 %'); // 23 / 40
    expect(kpi('Ocupación')).toContain('23 asignados de 40');
    expect(kpi('GMV aprobado')).toContain('$ 2,4 M');
    expect(kpi('GMV aprobado')).toContain('no es ingreso SaaS');
    expect(kpi('Reservas en curso')).toContain('3');
    expect(kpi('Reservas en curso')).toContain('1 en conciliación');
  });

  it('shows "—" for occupancy when nothing is sellable (spec: "Ocupación sin stands")', async () => {
    const empty = new InMemoryEventMetricsRepository([
      {
        eventId: 'demo-event',
        eventName: 'Vacío',
        venueName: 'X',
        startsAt: '2026-11-20T13:00:00Z',
        endsAt: '2026-11-20T23:00:00Z',
        layoutVersionId: 'demo-v1',
        sellableStands: 0,
        blockedStands: 0,
        assignedStands: 0,
        approvedGmvCents: 0,
        currency: 'ARS',
        activeReservations: 0,
        reconciliationPending: 0,
        gmvByMonth: [],
      },
    ]);
    const { kpi, host } = await render(empty);
    expect(kpi('Ocupación')).toContain('—');
    expect(host.textContent).not.toMatch(/NaN|Infinity/);
    expect(host.textContent).toContain('Sin ventas aprobadas todavía');
  });

  it('offers the chart data as a table (spec: "Gráfico con alternativa")', async () => {
    const { host } = await render();
    const rows = [...host.querySelectorAll('app-gmv-chart table tbody tr')].map((r) =>
      [...r.querySelectorAll('td')].map((td) => plain(td.textContent)).join(' '),
    );
    expect(rows).toHaveLength(6);
    expect(rows[0]).toBe('May $ 120.000');
    expect(rows[5]).toBe('Oct $ 522.000');
    expect(host.querySelectorAll('app-gmv-chart svg rect.bar')).toHaveLength(6);
    // One unit for every bar label, so values compare at a glance.
    const labels = [...host.querySelectorAll('app-gmv-chart svg text.value')].map((t) =>
      plain(t.textContent),
    );
    expect(labels).toEqual(['$ 0,1 M', '$ 0,2 M', '$ 0,4 M', '$ 0,5 M', '$ 0,7 M', '$ 0,5 M']);
    expect(host.querySelector('app-gmv-chart svg')?.getAttribute('role')).toBe('img');
  });

  it('links to the event plan editor (spec: "Atajo al editor")', async () => {
    const { host } = await render();
    const link = [...host.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Abrir editor de plano'),
    );
    expect(link?.getAttribute('href')).toBe('/organizador/layouts/demo-v1/editor');
  });

  it('shows operations and payments as pending, without data (spec: "Secciones sin backend")', async () => {
    const { host } = await render();
    const text = plain(host.textContent);
    expect(text).toContain('Últimas operaciones');
    expect(text).toContain('RES-01');
    expect(text).toContain('Estado de cobros');
    expect(text).toContain('PAY-01');
    // Sectors are modeled now (ADR 0002): the card says which task brings them, not "pending spec".
    expect(text).toContain('Ocupación por sector: disponible con EVT-01');
    expect(text).not.toContain('pendiente de que la spec');
  });

  it('shows an error when the event does not exist', async () => {
    const { host } = await render(new InMemoryEventMetricsRepository([]));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No se encontraron');
  });
});
