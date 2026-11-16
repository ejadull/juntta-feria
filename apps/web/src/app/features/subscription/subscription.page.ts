import { ConfirmDialog } from '../../shared/confirm-dialog';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  InjectionToken,
  signal,
  type OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { concatMap, finalize, take, takeWhile, timer, type Subscription } from 'rxjs';
import { messageFor } from '../../shared/auth/problem';
import { SessionStore } from '../../shared/auth/session.store';
import { EXTERNAL_NAVIGATION } from '../../shared/external-navigation';
import { SubscriptionApi, type SubscriptionDto } from './subscription.api';

/** How long the screen waits for the webhook that activates the subscription after authorizing. */
export const SUBSCRIPTION_POLL = new InjectionToken<{ intervalMs: number; attempts: number }>(
  'SubscriptionPoll',
  { providedIn: 'root', factory: () => ({ intervalMs: 4_000, attempts: 15 }) },
);

const ALREADY_ACTIVE = 'Ya tenés una suscripción activa.';
const BY_CODE: Readonly<Record<string, string>> = {
  SUBSCRIPTION_ALREADY_ACTIVE: ALREADY_ACTIVE,
  EXHIBITOR_REQUIRED: 'Solo las cuentas de feriante pueden suscribirse.',
};
const BY_STATUS: Readonly<Record<number, string>> = {
  400: 'Revisá el correo de tu cuenta de Mercado Pago.',
  503: 'La suscripción todavía no está disponible. Probá de nuevo más tarde.',
};
const FALLBACK = 'No pudimos completar la operación. Probá de nuevo en unos minutos.';
const LOAD_FAILED = 'No pudimos consultar tu suscripción. Probá de nuevo en unos minutos.';

const day = (iso: string): string => new Date(iso).toLocaleDateString('es-AR');
const valueOf = (event: Event): string => (event.target as HTMLInputElement).value;

/**
 * Suscripción de la plataforma (EXH-05): status, start (Mercado Pago preapproval) and cancel. It is
 * also the preapproval's `back_url`: activation arrives by webhook, so a pending status is re-read.
 */
@Component({
  selector: 'app-subscription-page',
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <p class="text-sm font-semibold tracking-wider text-primary-strong">FERIANTE</p>
      <h1 class="mt-1 text-3xl font-semibold">Suscripción</h1>
      <p class="mt-2 text-text-muted">
        Para reservar stands necesitás una suscripción activa a la plataforma. Se paga con Mercado
        Pago y podés cancelarla cuando quieras.
      </p>

      @if (loadError()) {
        <p role="alert" class="card mt-6 text-danger">{{ loadError() }}</p>
        <button type="button" class="btn mt-3" (click)="query()">Volver a consultar</button>
      } @else if (subscription(); as s) {
        <div class="card mt-6" role="status" aria-live="polite" data-testid="subscription-status">
          <p class="text-sm text-text-muted">Estado</p>
          <p class="text-xl font-semibold">{{ headline() }}</p>
          @if (detail(); as text) {
            <p class="mt-1 text-sm text-text-muted">{{ text }}</p>
          }
        </div>

        @if (s.status === 'PENDING') {
          <p class="mt-4 text-sm">
            @if (polling()) {
              Esperamos la confirmación de Mercado Pago; suele tardar unos segundos.
            } @else {
              Todavía no recibimos la confirmación. Si ya autorizaste el cobro, volvé a consultar.
            }
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            @if (s.initPoint; as link) {
              <button type="button" class="btn btn-primary" (click)="navigate(link)">
                Autorizar en Mercado Pago
              </button>
            }
            <button type="button" class="btn" [disabled]="polling()" (click)="query()">
              Volver a consultar
            </button>
          </div>
        }

        @if (canStart()) {
          <form class="card mt-6 flex flex-col gap-3" (submit)="start($event)" novalidate>
            <div class="flex flex-col gap-1">
              <label for="payer-email" class="text-sm font-medium"
                >Email de tu cuenta de Mercado Pago</label
              >
              <input
                id="payer-email"
                type="email"
                autocomplete="email"
                class="field"
                aria-describedby="payer-help"
                [value]="email()"
                (input)="email.set(valueOf($event))"
              />
              <p id="payer-help" class="text-xs text-text-muted">
                Tiene que ser el de la cuenta de Mercado Pago que va a pagar. En el entorno de
                prueba, el del comprador de prueba.
              </p>
            </div>
            @if (actionError(); as message) {
              <p role="alert" class="rounded-lg bg-danger/10 p-3 text-sm">{{ message }}</p>
            }
            <button type="submit" class="btn btn-primary self-start" [disabled]="busy()">
              {{ busy() ? 'Abriendo Mercado Pago…' : 'Suscribirme' }}
            </button>
          </form>
        } @else if (actionError(); as message) {
          <p role="alert" class="mt-4 rounded-lg bg-danger/10 p-3 text-sm">{{ message }}</p>
        }

        @if (s.status === 'ACTIVE' || s.status === 'PAST_DUE') {
          <div class="mt-5">
            <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="askCancel()">
              Cancelar suscripción
            </button>
          </div>
        }

        @if (confirming()) {
          <app-confirm-dialog
            heading="¿Cancelar la suscripción?"
            message="Vas a poder reservar hasta el fin del período ya pagado. Después, no."
            confirmLabel="Sí, cancelar"
            [busy]="busy()"
            (confirmed)="cancel()"
            (cancelled)="confirming.set(false)"
          />
        }
      } @else {
        <p role="status" class="mt-6 text-text-muted">Consultando tu suscripción…</p>
      }
    </section>
  `,
  styles: `
    .field {
      min-height: 2.75rem;
      padding: 0 0.75rem;
      border: 1px solid var(--color-border-strong);
      border-radius: 0.5rem;
      background: var(--color-surface);
      color: var(--color-text);
    }
    .field:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: 1px;
    }
  `,
})
export class SubscriptionPage implements OnInit {
  private readonly api = inject(SubscriptionApi);
  private readonly session = inject(SessionStore);
  private readonly poll = inject(SUBSCRIPTION_POLL);
  protected readonly navigate = inject(EXTERNAL_NAVIGATION);
  private readonly destroyRef = inject(DestroyRef);
  private read?: Subscription;
  private startKey = crypto.randomUUID();

  protected readonly valueOf = valueOf;
  protected readonly subscription = signal<SubscriptionDto | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly polling = signal(false);
  protected readonly busy = signal(false);
  protected readonly confirming = signal(false);
  protected readonly email = signal(this.session.user()?.email ?? '');

  protected readonly canStart = computed(() => {
    const status = this.subscription()?.status;
    return status === 'NONE' || status === 'CANCELLED' || status === 'PENDING';
  });

  protected readonly headline = computed(() => {
    const s = this.subscription();
    const until = s?.currentPeriodEnd ? day(s.currentPeriodEnd) : null;
    switch (s?.status) {
      case 'ACTIVE':
        return until ? `Activa hasta el ${until}` : 'Activa';
      case 'PENDING':
        return 'Pendiente de autorización';
      case 'PAST_DUE':
        return 'Pago atrasado';
      case 'CANCELLED':
        return this.stillCovered() ? `Cancelada: sigue activa hasta el ${until}` : 'Cancelada';
      default:
        return 'Sin suscripción';
    }
  });

  protected readonly detail = computed(() => {
    switch (this.subscription()?.status) {
      case 'NONE':
        return 'Todavía no te suscribiste.';
      case 'PAST_DUE':
        return 'No pudimos cobrar la última cuota. Revisá tu medio de pago en Mercado Pago.';
      case 'CANCELLED':
        return this.stillCovered()
          ? 'No se te va a cobrar de nuevo. Podés volver a suscribirte cuando quieras.'
          : 'Podés volver a suscribirte cuando quieras.';
      default:
        return null;
    }
  });

  ngOnInit(): void {
    this.query();
  }

  /** Reads the subscription; while it is pending it keeps reading until the webhook lands. */
  protected query(): void {
    this.read?.unsubscribe();
    this.loadError.set(null);
    this.polling.set(true);
    this.read = timer(0, this.poll.intervalMs)
      .pipe(
        take(this.poll.attempts),
        concatMap(() => this.api.get()),
        takeWhile((s) => s.status === 'PENDING', true),
        finalize(() => this.polling.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (s) => this.subscription.set(s),
        error: () => this.loadError.set(LOAD_FAILED),
      });
  }

  protected start(event: Event): void {
    event.preventDefault();
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.start(this.email().trim(), this.startKey).subscribe({
      next: (s) => {
        if (s.initPoint) this.navigate(s.initPoint);
        else this.busy.set(false);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        const message = messageFor(e, BY_CODE, BY_STATUS, FALLBACK);
        this.actionError.set(message);
        this.startKey = crypto.randomUUID();
        if (message === ALREADY_ACTIVE) this.query();
      },
    });
  }

  protected askCancel(): void {
    this.confirming.set(true);
  }

  protected cancel(): void {
    this.busy.set(true);
    this.api.cancel().subscribe({
      next: (s) => {
        this.subscription.set(s);
        this.confirming.set(false);
        this.busy.set(false);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.actionError.set(messageFor(e, BY_CODE, BY_STATUS, FALLBACK));
      },
    });
  }

  private stillCovered(): boolean {
    const end = this.subscription()?.currentPeriodEnd;
    return !!end && Date.parse(end) > Date.now();
  }
}
