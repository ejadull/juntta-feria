import { firstValueFrom } from 'rxjs';
import { EventNotFoundError } from './event-metrics.repository';
import {
  DEMO_EVENT_METRICS,
  InMemoryEventMetricsRepository,
} from './in-memory-event-metrics.repository';

describe('InMemoryEventMetricsRepository', () => {
  it('serves the demo event metrics', async () => {
    const repo = new InMemoryEventMetricsRepository();
    const m = await firstValueFrom(repo.get(DEMO_EVENT_METRICS.eventId));
    expect(m).toEqual(DEMO_EVENT_METRICS);
  });

  it('demo data is internally consistent (no impossible KPIs)', () => {
    const m = DEMO_EVENT_METRICS;
    expect(m.assignedStands + m.blockedStands).toBeLessThanOrEqual(m.sellableStands);
    expect(m.gmvByMonth.reduce((sum, p) => sum + p.cents, 0)).toBe(m.approvedGmvCents);
    expect(
      m.gmvByMonth.every((p) => /^\d{4}-\d{2}$/.test(p.month) && Number.isInteger(p.cents)),
    ).toBe(true);
  });

  it('fails with a typed error for an unknown event', async () => {
    const repo = new InMemoryEventMetricsRepository();
    await expect(firstValueFrom(repo.get('nope'))).rejects.toBeInstanceOf(EventNotFoundError);
  });
});
