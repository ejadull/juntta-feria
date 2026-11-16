import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  effect,
  inject,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly kind: ToastKind;
}

interface ToastOptions {
  readonly kind?: ToastKind;
  /** Auto-dismiss delay; errors are never dismissed on their own. */
  readonly durationMs?: number;
}

type AriaNotifyDocument = Document & {
  ariaNotify?: (message: string, options?: { priority?: 'normal' | 'high' }) => void;
};

export const TOAST_DURATION_MS = 6000;

/**
 * Non-blocking messages ("Guardado", "No pudimos…") shown by <app-toasts>. What a toast says must
 * also be reachable elsewhere in the page: it goes away and is not for critical decisions.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly doc = inject(DOCUMENT) as AriaNotifyDocument;
  private readonly list = signal<readonly Toast[]>([]);
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly durations = new Map<number, number>();
  private nextId = 1;

  readonly toasts = this.list.asReadonly();

  /** With ariaNotify() the text is announced through it; otherwise the toast is a live region. */
  readonly announcesNatively = typeof this.doc.ariaNotify === 'function';

  show(message: string, options: ToastOptions = {}): number {
    const kind = options.kind ?? 'info';
    const id = this.nextId++;
    this.list.update((all) => [...all, { id, message, kind }]);
    if (this.announcesNatively) {
      this.doc.ariaNotify?.(message, { priority: kind === 'error' ? 'high' : 'normal' });
    }
    if (kind !== 'error') {
      this.durations.set(id, options.durationMs ?? TOAST_DURATION_MS);
      this.resume(id);
    }
    return id;
  }

  dismiss(id: number): void {
    this.pause(id);
    this.durations.delete(id);
    this.list.update((all) => all.filter((t) => t.id !== id));
  }

  /** Holds the countdown while the reader is focused on the toast. */
  pause(id: number): void {
    const timer = this.timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(id);
  }

  resume(id: number): void {
    const duration = this.durations.get(id);
    if (duration === undefined) return;
    this.pause(id);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), duration),
    );
  }
}

/** The toast region: one popover in the top layer holding every open toast, mounted in the shell. */
@Component({
  selector: 'app-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="region" aria-label="Notificaciones">
      <div #stack popover="manual" class="toast-stack" (focusin)="remember($event)">
        @for (toast of service.toasts(); track toast.id) {
          <div
            class="toast"
            [attr.data-kind]="toast.kind"
            [attr.role]="liveRole(toast.kind)"
            (focusin)="service.pause(toast.id)"
            (focusout)="service.resume(toast.id)"
          >
            <p class="toast-message">{{ toast.message }}</p>
            <button type="button" class="toast-close" (click)="close(toast.id)">Cerrar</button>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .toast-stack {
      position: fixed;
      inset: auto 1rem 1rem auto;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      overflow: visible;
      width: min(24rem, calc(100dvw - 2rem));
      flex-direction: column;
      gap: 0.5rem;
    }
    .toast-stack:popover-open {
      display: flex;
    }
    .toast {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border: 1px solid var(--color-border-strong);
      border-inline-start-width: 0.375rem;
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: 0 8px 24px -12px rgb(0 0 0 / 0.35);
      font-size: 0.875rem;
      transition:
        opacity 0.2s ease,
        translate 0.2s ease;
      @starting-style {
        opacity: 0;
        translate: 0 0.5rem;
      }
    }
    .toast[data-kind='success'] {
      border-inline-start-color: var(--color-available);
    }
    .toast[data-kind='error'] {
      border-color: var(--color-danger);
    }
    .toast-message {
      flex: 1;
      margin: 0;
      overflow-wrap: anywhere;
    }
    .toast-close {
      flex-shrink: 0;
      min-height: var(--target-size, 2.25rem);
      min-width: var(--target-size, 2.25rem);
      padding: 0 0.5rem;
      border-radius: var(--radius-sm);
      font-weight: 600;
      text-decoration: underline;
    }
    .toast-close:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
      .toast {
        transition: none;
      }
    }
  `,
})
export class Toasts {
  protected readonly service = inject(ToastService);
  private readonly stack = viewChild.required<ElementRef<HTMLElement>>('stack');
  private readonly doc = inject(DOCUMENT);
  private outsideFocus: HTMLElement | null = null;

  constructor() {
    // The popover is open exactly while there is something to show.
    effect(() => {
      const el = this.stack().nativeElement;
      const open = this.service.toasts().length > 0;
      if (typeof el.showPopover !== 'function') return;
      try {
        if (open) el.showPopover();
        else el.hidePopover();
      } catch {
        // already in the requested state
      }
    });
  }

  protected liveRole(kind: ToastKind): string | null {
    if (this.service.announcesNatively) return null;
    return kind === 'error' ? 'alert' : 'status';
  }

  /** Remembers where focus came from so closing the last toast can hand it back. */
  protected remember(event: FocusEvent): void {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !this.stack().nativeElement.contains(from)) {
      this.outsideFocus = from;
    }
  }

  protected close(id: number): void {
    const buttons = [
      ...this.stack().nativeElement.querySelectorAll<HTMLButtonElement>('.toast-close'),
    ];
    const focused = buttons.find((b) => b === this.doc.activeElement);
    const next = focused ? buttons.find((b) => b !== focused) : undefined;
    this.service.dismiss(id);
    if (!focused) return;
    (next ?? this.outsideFocus)?.focus();
  }
}
