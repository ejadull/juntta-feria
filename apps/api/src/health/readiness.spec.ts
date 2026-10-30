import { runChecks, type ReadinessCheck } from './readiness.js';

const check = (name: string, run: () => Promise<void>): ReadinessCheck => ({
  name,
  check: run,
});
const up = (name: string) => check(name, async () => {});
const down = (name: string, message = 'password=hunter2 refused') =>
  check(name, async () => {
    throw new Error(message);
  });

describe('runChecks', () => {
  it('reports ok when every dependency is up', async () => {
    await expect(
      runChecks([up('postgres'), up('redis'), up('storage')], 100),
    ).resolves.toEqual({
      status: 'ok',
      checks: { postgres: 'up', redis: 'up', storage: 'up' },
    });
  });

  it('reports error and which dependency is down, without its message', async () => {
    const result = await runChecks(
      [up('postgres'), down('redis'), up('storage')],
      100,
    );
    expect(result).toEqual({
      status: 'error',
      checks: { postgres: 'up', redis: 'down', storage: 'up' },
    });
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('marks a hanging dependency as down after the timeout', async () => {
    const hang = check('storage', () => new Promise<void>(() => {}));
    const started = Date.now();
    const result = await runChecks([up('postgres'), hang], 50);
    expect(result.checks.storage).toBe('down');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('runs the checks in parallel', async () => {
    const slow = (name: string) =>
      check(name, () => new Promise((r) => setTimeout(r, 40)));
    const started = Date.now();
    await runChecks([slow('a'), slow('b'), slow('c')], 500);
    expect(Date.now() - started).toBeLessThan(110);
  });
});
