import { firstValueFrom } from 'rxjs';
import { validateLayout } from '../domain/validation';
import { DEMO_LAYOUT, STRESS_LAYOUT } from './demo-layout';
import { InMemoryLayoutRepository } from './in-memory-layout.repository';

describe('seed layouts', () => {
  it('demo layout is valid', () => {
    expect(validateLayout(DEMO_LAYOUT)).toEqual([]);
  });

  it('stress layout has 500 valid stands with unique codes (LUI-09)', () => {
    const stands = STRESS_LAYOUT.objects.filter((o) => o.kind === 'STAND');
    expect(stands).toHaveLength(500);
    expect(new Set(stands.map((s) => s.code)).size).toBe(500);
    expect(validateLayout(STRESS_LAYOUT)).toEqual([]);
  });

  it('the default in-memory repository serves both seeds', async () => {
    const repo = new InMemoryLayoutRepository();
    expect((await firstValueFrom(repo.get('stress-500'))).objects.length).toBeGreaterThanOrEqual(
      500,
    );
    expect((await firstValueFrom(repo.get('demo-v1'))).id).toBe('demo-v1');
  });
});
