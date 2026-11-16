import { TestBed } from '@angular/core/testing';
import { TOAST_DURATION_MS, ToastService, Toasts } from './toast';

describe('ToastService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    delete (document as { ariaNotify?: unknown }).ariaNotify;
  });

  it('dismisses informational toasts after the delay', () => {
    const service = TestBed.inject(ToastService);
    service.show('Guardado', { kind: 'success' });
    expect(service.toasts().map((t) => t.message)).toEqual(['Guardado']);
    vi.advanceTimersByTime(TOAST_DURATION_MS);
    expect(service.toasts()).toEqual([]);
  });

  it('keeps error toasts until they are dismissed', () => {
    const service = TestBed.inject(ToastService);
    const id = service.show('No pudimos guardar', { kind: 'error' });
    vi.advanceTimersByTime(TOAST_DURATION_MS * 10);
    expect(service.toasts()).toHaveLength(1);
    service.dismiss(id);
    expect(service.toasts()).toEqual([]);
  });

  it('holds the countdown while paused and restarts it on resume', () => {
    const service = TestBed.inject(ToastService);
    const id = service.show('Hola', { durationMs: 1000 });
    service.pause(id);
    vi.advanceTimersByTime(5000);
    expect(service.toasts()).toHaveLength(1);
    service.resume(id);
    vi.advanceTimersByTime(1000);
    expect(service.toasts()).toEqual([]);
  });

  it('announces through ariaNotify() when the browser has it', () => {
    const ariaNotify = vi.fn();
    (document as unknown as { ariaNotify: typeof ariaNotify }).ariaNotify = ariaNotify;
    const service = TestBed.inject(ToastService);
    service.show('Listo');
    service.show('Falló', { kind: 'error' });
    expect(service.announcesNatively).toBe(true);
    expect(ariaNotify).toHaveBeenNthCalledWith(1, 'Listo', { priority: 'normal' });
    expect(ariaNotify).toHaveBeenNthCalledWith(2, 'Falló', { priority: 'high' });
  });
});

describe('Toasts', () => {
  it('renders a named region, live roles without ariaNotify and a Close button', async () => {
    const fixture = TestBed.createComponent(Toasts);
    const service = TestBed.inject(ToastService);
    service.show('Guardado', { kind: 'success' });
    service.show('Falló', { kind: 'error' });
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(
      'Notificaciones',
    );
    expect(host.querySelector('[popover="manual"]')).not.toBeNull();
    const toasts = [...host.querySelectorAll('.toast')];
    expect(toasts.map((t) => t.getAttribute('role'))).toEqual(['status', 'alert']);
    const close = host.querySelector<HTMLButtonElement>('.toast-close')!;
    expect(close.textContent?.trim()).toBe('Cerrar');
    close.click();
    await fixture.whenStable();
    expect(host.querySelectorAll('.toast')).toHaveLength(1);
  });
});
