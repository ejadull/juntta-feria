import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmDialog } from './confirm-dialog';

@Component({
  selector: 'app-host',
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button id="invoker" type="button" (click)="asking.set(true)">Borrar</button>
    @if (asking()) {
      <app-confirm-dialog
        heading="¿Borrar esto?"
        message="No se puede deshacer."
        confirmLabel="Sí, borrar"
        [busy]="busy()"
        (confirmed)="confirmed = confirmed + 1"
        (cancelled)="cancelled = cancelled + 1; asking.set(false)"
      />
    }
  `,
})
class Host {
  readonly asking = signal(false);
  readonly busy = signal(false);
  confirmed = 0;
  cancelled = 0;
}

async function open() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const invoker = host.querySelector<HTMLButtonElement>('#invoker')!;
  invoker.focus();
  invoker.click();
  await fixture.whenStable();
  const dialog = host.querySelector<HTMLDialogElement>('dialog')!;
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
  return { fixture, host, invoker, dialog, button };
}

describe('ConfirmDialog', () => {
  it('opens as a native modal named by its title and described by its message', async () => {
    const { host, dialog } = await open();
    expect(dialog.open).toBe(true);
    expect(dialog.hasAttribute('role')).toBe(false);
    expect(dialog.hasAttribute('aria-modal')).toBe(false);
    expect(host.querySelector(`#${dialog.getAttribute('aria-labelledby')}`)?.textContent).toBe(
      '¿Borrar esto?',
    );
    expect(host.querySelector(`#${dialog.getAttribute('aria-describedby')}`)?.textContent).toBe(
      'No se puede deshacer.',
    );
  });

  it('puts the focus on the safe action and styles the destructive one as danger', async () => {
    const { button } = await open();
    expect(document.activeElement).toBe(button('Cancelar'));
    expect(button('Cancelar').hasAttribute('autofocus')).toBe(true);
    expect(button('Sí, borrar').classList.contains('btn-danger')).toBe(true);
  });

  it('emits confirmed from the destructive button without closing by itself', async () => {
    const { fixture, button, dialog } = await open();
    button('Sí, borrar').click();
    await fixture.whenStable();
    expect(fixture.componentInstance.confirmed).toBe(1);
    expect(fixture.componentInstance.cancelled).toBe(0);
    expect(dialog.open).toBe(true);
  });

  it('cancels with the Cancel button', async () => {
    const { fixture, button, host } = await open();
    button('Cancelar').click();
    await fixture.whenStable();
    expect(fixture.componentInstance.cancelled).toBe(1);
    expect(host.querySelector('dialog')).toBeNull();
  });

  it('cancels with Esc (the native cancel and close events)', async () => {
    const { fixture, dialog, host } = await open();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    dialog.dispatchEvent(new Event('close'));
    await fixture.whenStable();
    expect(fixture.componentInstance.cancelled).toBe(1);
    expect(host.querySelector('dialog')).toBeNull();
  });

  it('ignores Esc and disables both actions while the confirmed action is in flight', async () => {
    const { fixture, dialog, button } = await open();
    fixture.componentInstance.busy.set(true);
    await fixture.whenStable();
    const esc = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(button('Sí, borrar').disabled).toBe(true);
    expect(button('Cancelar').disabled).toBe(true);
  });
});
