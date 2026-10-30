import { firstValueFrom } from 'rxjs';
import { DEMO_EVENT_METRICS } from '../../dashboard/data/in-memory-event-metrics.repository';
import { DEMO_LAYOUT } from '../../layout-editor/data/demo-layout';
import {
  PublicEventNotFoundError,
  type PublicStandStatus,
  type StandProperties,
} from './public-catalog.repository';
import {
  DEMO_EVENT_SLUG,
  InMemoryPublicCatalogRepository,
} from './in-memory-public-catalog.repository';

const repo = () => new InMemoryPublicCatalogRepository();

async function stands(): Promise<StandProperties[]> {
  const map = await firstValueFrom(repo().getMap(DEMO_EVENT_SLUG));
  return map.features.flatMap((f) => (f.properties.kind === 'STAND' ? [f.properties] : []));
}

describe('InMemoryPublicCatalogRepository (PUB-UI-02)', () => {
  it('lists the demo events, with availability taken from the map', async () => {
    const events = await firstValueFrom(repo().listEvents());
    expect(events.map((e) => e.slug)).toEqual([
      DEMO_EVENT_SLUG,
      'feria-del-litoral-artesanal',
      'mendoza-sabores-y-diseno',
    ]);
    const demo = events[0];
    const available = (await stands()).filter((s) => s.status === 'AVAILABLE').length;
    expect(demo.availableStands).toBe(available);
    expect(demo.totalStands).toBe(40);
    expect(events[2].salesOpen).toBe(false);
  });

  it('serves the demo plan geometry with consistent public states (matches the Panel)', async () => {
    const map = await firstValueFrom(repo().getMap(DEMO_EVENT_SLUG));
    expect(map.bounds).toEqual({ width: DEMO_LAYOUT.widthM, height: DEMO_LAYOUT.heightM });
    expect(map.features).toHaveLength(DEMO_LAYOUT.objects.length);

    const count = (status: PublicStandStatus) =>
      stands().then((all) => all.filter((s) => s.status === status).length);
    expect(await count('AVAILABLE')).toBe(12);
    expect(await count('RESERVED')).toBe(DEMO_EVENT_METRICS.activeReservations);
    expect(await count('OCCUPIED')).toBe(DEMO_EVENT_METRICS.assignedStands);
    expect(await count('BLOCKED')).toBe(DEMO_EVENT_METRICS.blockedStands);
  });

  it('assigns every stand a sector and a price, and exposes exhibitors only on occupied stands', async () => {
    for (const s of await stands()) {
      expect(s.sector).toBeTruthy();
      expect(s.price.valueCents).toBeGreaterThan(0);
      if (s.exhibitor) expect(s.status).toBe('OCCUPIED');
    }
  });

  it('never exposes private exhibitor data (INV-08, AC-11)', async () => {
    const json = JSON.stringify([
      await firstValueFrom(repo().getMap(DEMO_EVENT_SLUG)),
      await firstValueFrom(repo().listExhibitors(DEMO_EVENT_SLUG)),
    ]);
    for (const forbidden of ['taxId', 'legalName', 'CUIT', '20-0000', 'email', 'phone'])
      expect(json).not.toContain(forbidden);
    const directory = await firstValueFrom(repo().listExhibitors(DEMO_EVENT_SLUG));
    expect(directory.length).toBeGreaterThan(0);
    expect(directory.map((e) => e.name)).not.toContain('Cordero & Lúpulo'); // no consent
  });

  it('fails with a typed error for an unknown or map-less event', async () => {
    await expect(firstValueFrom(repo().getMap('nope'))).rejects.toBeInstanceOf(
      PublicEventNotFoundError,
    );
    await expect(firstValueFrom(repo().getMap('mendoza-sabores-y-diseno'))).rejects.toBeInstanceOf(
      PublicEventNotFoundError,
    );
  });
});
