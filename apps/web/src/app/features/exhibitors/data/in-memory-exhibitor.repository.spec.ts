import { firstValueFrom } from 'rxjs';
import type { DocumentsStatus } from './exhibitor.repository';
import { DEMO_EXHIBITORS, InMemoryExhibitorRepository } from './in-memory-exhibitor.repository';

describe('InMemoryExhibitorRepository', () => {
  it('lists the demo exhibitors', async () => {
    const list = await firstValueFrom(new InMemoryExhibitorRepository().list());
    expect(list).toEqual(DEMO_EXHIBITORS);
  });

  it('demo data covers every documentation status and a missing tax id', () => {
    const statuses = new Set<DocumentsStatus>(DEMO_EXHIBITORS.map((e) => e.documentsStatus));
    expect([...statuses].sort()).toEqual(['APPROVED', 'MISSING', 'PENDING', 'REJECTED']);
    expect(DEMO_EXHIBITORS.some((e) => e.taxId === null)).toBe(true);
    expect(new Set(DEMO_EXHIBITORS.map((e) => e.id)).size).toBe(DEMO_EXHIBITORS.length);
  });

  it('uses obviously fictitious tax ids (never a plausible real CUIT)', () => {
    for (const e of DEMO_EXHIBITORS) if (e.taxId) expect(e.taxId).toMatch(/^\d{2}-000000\d{2}-\d$/);
  });
});
