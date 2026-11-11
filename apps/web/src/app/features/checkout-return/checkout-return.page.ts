import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  InjectionToken,
  input,
  signal,
  type OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { concatMap, finalize, take, takeWhile, timer, type Subscription } from 'rxjs';
import { MercadoPagoWallet, type CheckoutDto } from '../../shared/mercado-pago-wallet';
import { formatArs } from '../../shared/money';
import {
  ReservationPaymentRepository,
  type ReservationDto,
  type ReservationStatus,
} from './data/reservation-payment.repository';

/** What Mercado Pago's `back_urls` say happened. It only picks the wording, never the state. */
export type CheckoutOutcome = 'approved' | 'pending' | 'rejected';

/** How long P19 waits for the webhook before asking the exhibitor to check again. */
export const CHECKOUT_POLL = new InjectionToken<{ intervalMs: number; attempts: number }>(
  'CheckoutPoll',
  { providedIn: 'root', factory: () => ({ intervalMs: 4_000, attempts: 15 }) },
);

const WAITING: ReadonlySet<ReservationStatus> = new Set(['HELD', 'PAYMENT_PENDING']);

const CLOSED: Partial<Record<ReservationStatus, string>> = {
  CANCELLED: 'La reserva se canceló y el stand se liberó.',
  REFUND_PENDING: 'La reserva se canceló y estamos devolviendo el pago a tu medio de pago.',
  REFUNDED: 'La reserva se canceló y el pago ya se devolvió a tu medio de pago.',
};

type View = 'loading' | 'confirmed' | 'waiting' | 'rejected' | 'expired' | 'closed';

/**
 * P19 (PAY-04): return from Mercado Pago's checkout. The query params Mercado Pago adds
 * (`payment_id`, `status`, …) are ignored: what is shown comes from our API, which only changes
 * when the webhook arrives (§5.2), so an approved return waits for it.
 */
@Component({
  selector: 'app-checkout-return-page',
  imports: [RouterLink, MercadoPagoWallet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <p class="text-sm font-semibold tracking-wider text-primary-strong">FERIANTE</p>

      @switch (view()) {
        @case ('loading') {
          <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Pago de tu reserva</h1>
          @if (!failed()) {
            <p role="status" class="mt-6 text-text-muted">Consultando tu reserva…</p>
          }
        }
        @case ('confirmed') {
          <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">¡Listo! Tu stand está confirmado</h1>
          <p
            role="status"
            data-ui="confirmed"
            class="mt-6 rounded-xl bg-available/15 p-4 text-text"
          >
            <span aria-hidden="true">✓</span> Recibimos el pago. Ya podés ver la reserva en tus
            reservas.
          </p>
        }
        @case ('waiting') {
          @if (outcome() === 'pending') {
            <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Tu pago está pendiente</h1>
            <div role="status" class="mt-6 space-y-2 rounded-xl bg-reserved/15 p-4 text-text">
              <p>
                Si elegiste pagar en efectivo (Rapipago o Pago Fácil), el pago se acredita cuando
                pagás el cupón.
                @if (holdUntil(); as until) {
                  El stand queda reservado para vos hasta las <strong>{{ until }}</strong
                  >.
                }
                Pagalo antes: después el cupón vence y el stand se libera.
              </p>
              <p>Si pagaste con tarjeta, Mercado Pago puede tardar unos minutos en acreditarlo.</p>
            </div>
          } @else {
            <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Estamos confirmando tu pago</h1>
            <p role="status" class="mt-6 rounded-xl bg-reserved/15 p-4 text-text">
              @if (polling()) {
                Mercado Pago nos avisó que el pago salió bien. Esperamos su confirmación para
                reservar el stand; suele tardar unos segundos.
              } @else {
                Todavía no llegó la confirmación de Mercado Pago. Volvé a consultar en un rato: no
                hace falta pagar de nuevo.
              }
            </p>
          }
        }
        @case ('rejected') {
          <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">El pago fue rechazado</h1>
          @if (holdUntil(); as until) {
            <p class="mt-6 text-text">
              No se cobró nada. Podés intentar con otro medio de pago hasta las
              <strong>{{ until }}</strong
              >, mientras el stand siga reservado para vos.
            </p>
            @if (retryCheckout(); as checkout) {
              <div class="mt-4"><app-mercado-pago-wallet [checkout]="checkout" /></div>
            } @else {
              <button
                type="button"
                class="btn btn-primary mt-4"
                [disabled]="retrying()"
                (click)="retry()"
              >
                Reintentar el pago
              </button>
            }
          } @else {
            <p class="mt-6 text-text">
              No se cobró nada. El tiempo de reserva venció, así que el stand ya no está reservado
              para vos.
            </p>
            <a class="btn mt-4" routerLink="/feriante/explorar">Elegir otro stand</a>
          }
        }
        @case ('expired') {
          <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">La reserva venció</h1>
          <p class="mt-6 text-text">
            No recibimos el pago a tiempo y el stand se liberó. Si Mercado Pago te cobró igual, el
            organizador lo revisa y te devuelve el dinero.
          </p>
          <a class="btn mt-4" routerLink="/feriante/explorar">Elegir otro stand</a>
        }
        @case ('closed') {
          <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Esta reserva ya no está activa</h1>
          <p class="mt-6 text-text">{{ closedText() }}</p>
        }
      }

      @if (failed()) {
        <p role="alert" class="mt-6 rounded-xl bg-danger/10 p-4 text-text">
          No pudimos consultar tu reserva. Probá de nuevo en unos minutos.
        </p>
      }
      @if (retryFailed()) {
        <p role="alert" class="mt-4 rounded-xl bg-danger/10 p-4 text-text">
          No pudimos abrir Mercado Pago. Probá de nuevo.
        </p>
      }

      @if (reservation(); as r) {
        <dl class="card mt-6 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt class="text-text-muted">Stand</dt>
            <dd class="font-medium">{{ r.stand.code }}</dd>
          </div>
          <div>
            <dt class="text-text-muted">Superficie</dt>
            <dd class="font-medium">{{ r.stand.areaM2 }} m²</dd>
          </div>
          <div>
            <dt class="text-text-muted">Importe</dt>
            <dd class="font-medium">{{ price(r) }}</dd>
          </div>
        </dl>
      }

      <div class="mt-6 flex flex-wrap gap-2">
        @if (failed() || view() === 'waiting') {
          <button type="button" class="btn" [disabled]="polling()" (click)="query()">
            Volver a consultar
          </button>
        }
        <a class="btn" routerLink="/feriante/reservas">Ver mis reservas</a>
      </div>
    </div>
  `,
})
export class CheckoutReturnPage implements OnInit {
  readonly id = input.required<string>();
  readonly outcome = input.required<CheckoutOutcome>();

  private readonly repository = inject(ReservationPaymentRepository);
  private readonly poll = inject(CHECKOUT_POLL);
  private readonly destroyRef = inject(DestroyRef);
  private subscription?: Subscription;

  protected readonly reservation = signal<ReservationDto | null>(null);
  protected readonly failed = signal(false);
  protected readonly polling = signal(false);
  protected readonly retrying = signal(false);
  protected readonly retryFailed = signal(false);
  /** The open preference, rendered as Checkout Pro's Wallet Brick. */
  protected readonly retryCheckout = signal<CheckoutDto | null>(null);

  protected readonly view = computed<View>(() => {
    const r = this.reservation();
    if (!r) return 'loading';
    if (r.status === 'CONFIRMED') return 'confirmed';
    if (r.status === 'EXPIRED') return 'expired';
    if (!WAITING.has(r.status)) return 'closed';
    return this.outcome() === 'rejected' ? 'rejected' : 'waiting';
  });

  /** Hold deadline as "HH:MM", only while it is still ahead. */
  protected readonly holdUntil = computed(() => {
    const iso = this.reservation()?.holdExpiresAt;
    if (!iso || Date.parse(iso) <= Date.now()) return null;
    return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  });

  protected readonly closedText = computed(() => CLOSED[this.reservation()!.status] ?? '');

  ngOnInit(): void {
    this.query();
  }

  /** Reads the reservation; approved/pending returns keep reading until the webhook lands. */
  protected query(): void {
    this.subscription?.unsubscribe();
    this.failed.set(false);
    this.polling.set(true);
    const reads = this.outcome() === 'rejected' ? 1 : this.poll.attempts;
    this.subscription = timer(0, this.poll.intervalMs)
      .pipe(
        take(reads),
        concatMap(() => this.repository.reservation(this.id())),
        takeWhile((r) => WAITING.has(r.status), true),
        finalize(() => this.polling.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (r) => this.reservation.set(r),
        error: () => this.failed.set(true),
      });
  }

  protected retry(): void {
    this.retrying.set(true);
    this.retryFailed.set(false);
    this.repository.checkout(this.id()).subscribe({
      next: (checkout) => this.retryCheckout.set(checkout),
      error: () => {
        this.retrying.set(false);
        this.retryFailed.set(true);
      },
    });
  }

  protected price(r: ReservationDto): string {
    return formatArs(r.amount.valueCents);
  }
}
