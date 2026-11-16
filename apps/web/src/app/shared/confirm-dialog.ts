import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

let nextId = 0;

/**
 * Confirmation of a destructive action on a native modal `<dialog>`.
 *
 * Render it inside an `@if`: it opens as a modal after its first render and closes (returning focus
 * to the invoker, which the browser does) when destroyed. The safe action holds `autofocus`.
 * Esc and the back gesture emit `cancelled`; the confirm button emits `confirmed` and leaves the
 * dialog open so the page can show a failure inside it; the parent removes it once done.
 * Anything projected is rendered between the message and the buttons.
 */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      class="dialog"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="messageId"
      (close)="onClosed()"
      (cancel)="onCancel($event)"
    >
      <h2 [id]="titleId" class="font-semibold">{{ heading() }}</h2>
      <p [id]="messageId" class="mt-1 text-sm text-text-muted">{{ message() }}</p>
      <ng-content />
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          class="btn"
          [class.btn-danger]="tone() === 'danger'"
          [class.btn-primary]="tone() === 'primary'"
          [disabled]="busy()"
          (click)="confirmed.emit()"
        >
          {{ confirmLabel() }}
        </button>
        <button type="button" class="btn" autofocus [disabled]="busy()" (click)="dismiss()">
          {{ cancelLabel() }}
        </button>
      </div>
    </dialog>
  `,
  styles: `
    .dialog {
      width: min(32rem, calc(100vw - 2rem));
      max-height: calc(100dvh - 2rem);
      padding: 1.25rem;
      border: 1px solid var(--color-border-strong);
      border-radius: 0.75rem;
      background: var(--color-surface);
      color: var(--color-text);
      overflow: auto;
      overscroll-behavior: contain;
    }

    .dialog::backdrop {
      overflow: hidden;
      overscroll-behavior: contain;
      background: color-mix(in srgb, var(--color-text) 45%, transparent);
    }
  `,
})
export class ConfirmDialog {
  /** Question shown as the dialog's accessible name. */
  readonly heading = input.required<string>();
  /** Consequence, linked as the accessible description. */
  readonly message = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly cancelLabel = input('Cancelar');
  /** `danger` for destructive actions (the default); `primary` for plain confirmations. */
  readonly tone = input<'danger' | 'primary'>('danger');
  /** Locks both actions (and Esc) while the confirmed action is in flight. */
  readonly busy = input(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  protected readonly titleId = `confirm-dialog-title-${nextId}`;
  protected readonly messageId = `confirm-dialog-text-${nextId++}`;

  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private disposed = false;

  constructor() {
    afterNextRender(() => {
      const dialog = this.dialogRef().nativeElement;
      // jsdom has no showModal(); the attribute keeps the content reachable there.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else {
        dialog.setAttribute('open', '');
        dialog.querySelector<HTMLElement>('[autofocus]')?.focus();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
      const dialog = this.dialogRef().nativeElement;
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
    });
  }

  protected dismiss(): void {
    const dialog = this.dialogRef().nativeElement;
    if (typeof dialog.close === 'function') {
      dialog.close();
      return;
    }
    dialog.removeAttribute('open');
    this.onClosed();
  }

  protected onCancel(event: Event): void {
    if (this.busy()) event.preventDefault();
  }

  /** The browser already closed it: Esc, back gesture or our Cancel button. */
  protected onClosed(): void {
    if (!this.disposed) this.cancelled.emit();
  }
}
