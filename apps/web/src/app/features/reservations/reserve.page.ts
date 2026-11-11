import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
  type OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { interval } from 'rxjs';
import { problemOf } from '../../shared/auth/problem';
import { MercadoPagoWallet, type CheckoutDto } from '../../shared/mercado-pago-wallet';
import { formatArs } from '../../shared/money';
import {
  ReservationPaymentRepository,
  type ReservationDto,
} from '../checkout-return/data/reservation-payment.repository';
import { PublicCatalogRepository } from '../public-catalog/data/public-catalog.repository';
import { standsOf, type StandView } from '../public-catalog/domain/stand-filters';
import { ReservationsApi } from './data/reservations.api';
import { friendly, type FriendlyError } from './reservation-errors';
import { clock, TERMS_VERSION } from './reservation-status';

const STAND_GONE = 'No encontramos ese stand en la feria. Volvé a explorar los stands.';
const NOT_AVAILABLE = 'Este stand ya no está disponible para reservar.';
const LOAD_FAILED = 'No pudimos cargar el stand. Probá de nuevo en unos minutos.';
const NOT_PAYABLE = 'Esta reserva ya no se puede pagar.';

/**
 * P18 "Reserva y pago" (RES-01, PAY-02): summary and terms, then hold, countdown and Mercado Pago's
 * Wallet Brick. `reserva` resumes the payment of a reservation that already exists.
 */
@Component({
  selector: 'app-reserve-page',
  imports: [RouterLink, MercadoPagoWallet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <p class="text-sm font-semibold tracking-wider text-primary">FERIANTE</p>
      <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Reserva y pago</h1>

      @if (loadError(); as message) {
        <p role="alert" class="mt-6 rounded-xl bg-danger/10 p-4">{{ message }}</p>
        <a class="btn mt-4" [routerLink]="exploreLink()">Volver a explorar stands</a>
      } @else if (reservation(); as r) {
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
            <dd class="font-medium">{{ price(r.amount.valueCents) }}</dd>
          </div>
        </dl>

        @if (expired()) {
          <p role="alert" class="mt-6 rounded-xl bg-reserved/15 p-4">
            El tiempo de reserva venció y el stand se liberó. Si querés, elegí el stand de nuevo.
          </p>
          <a class="btn btn-primary mt-4" [routerLink]="exploreLink()">Elegir un stand</a>
        } @else {
          <section class="mt-6" aria-labelledby="pay-title">
            <h2 id="pay-title" class="text-xl font-semibold">Pagá para confirmar tu stand</h2>
            @if (remainingMs() !== null) {
              <p class="mt-2">
                El stand es tuyo por
                <strong role="timer" data-testid="hold-clock">{{ clockText() }}</strong
                >. Si no pagás a tiempo, se libera.
              </p>
              <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
            }
            @if (checkout(); as c) {
              <div class="mt-4"><app-mercado-pago-wallet [checkout]="c" /></div>
              <p class="mt-3 text-sm text-text-muted">
                Cuando termines, Mercado Pago te trae de vuelta y confirmamos el pago.
                <a
                  class="underline"
                  [routerLink]="['/feriante/reservas', r.id, 'pago', 'pendiente']"
                  >Ver el estado del pago</a
                >.
              </p>
            } @else if (!busy()) {
              <button type="button" class="btn btn-primary mt-4" (click)="openCheckout(r.id)">
                Reintentar el pago
              </button>
            }
            <button
              type="button"
              class="btn mt-4 ml-2"
              [disabled]="busy()"
              (click)="cancelHold(r.id)"
            >
              Cancelar reserva
            </button>
          </section>
        }

        @if (error(); as e) {
          <div role="alert" class="mt-4 rounded-xl bg-danger/10 p-4 text-sm">{{ e.text }}</div>
        }
      } @else if (stand(); as s) {
        <section class="card mt-6" aria-labelledby="summary-title">
          <h2 id="summary-title" class="text-lg font-semibold">Resumen</h2>
          <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt class="text-text-muted">Stand</dt>
            <dd class="font-medium">{{ s.code }}</dd>
            <dt class="text-text-muted">Sector</dt>
            <dd>{{ s.sector ?? 'Sin sector' }}</dd>
            <dt class="text-text-muted">Superficie</dt>
            <dd>{{ s.areaM2 }} m²</dd>
            <dt class="text-text-muted">Precio final</dt>
            <dd class="font-semibold">{{ price(s.priceCents) }}</dd>
          </dl>
          <p class="mt-4 text-sm text-text-muted">
            Al reservar, el stand queda retenido para vos unos minutos mientras pagás con Mercado
            Pago. Si no pagás a tiempo, se libera.
          </p>
          <label class="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              class="mt-1 size-4"
              [checked]="accepted()"
              (change)="accepted.set(!accepted())"
            />
            <span>
              Acepto los términos y condiciones de participación (versión {{ termsVersion }}).
            </span>
          </label>

          @if (error(); as e) {
            <div role="alert" class="mt-4 rounded-xl bg-danger/10 p-4 text-sm">
              <p>{{ e.text }}</p>
              @if (e.needsSubscription) {
                <a class="btn btn-primary mt-3" routerLink="/feriante/suscripcion">
                  Activar mi suscripción
                </a>
              }
              @if (e.needsReservations) {
                <a class="btn btn-primary mt-3" routerLink="/feriante/reservas"
                  >Ir a Mis reservas</a
                >
              }
            </div>
          }

          <div class="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-primary"
              [disabled]="!accepted() || busy()"
              (click)="reserve(s)"
            >
              {{ busy() ? 'Reservando…' : 'Reservar y pagar' }}
            </button>
            <a class="btn" [routerLink]="exploreLink()">Elegir otro stand</a>
          </div>
        </section>
      } @else {
        <p role="status" class="mt-6 text-text-muted">Cargando el stand…</p>
      }
    </div>
  `,
})
export class ReservePage implements OnInit {
  /** Query params (withComponentInputBinding): the event stand to hold, its event, a reservation to resume. */
  readonly stand_ = input<string | undefined>(undefined, { alias: 'stand' });
  readonly feria = input<string | undefined>();
  readonly reserva = input<string | undefined>();

  private readonly catalog = inject(PublicCatalogRepository);
  private readonly payments = inject(ReservationPaymentRepository);
  private readonly api = inject(ReservationsApi);
  private readonly router = inject(Router);
  private holdKey = crypto.randomUUID();
  private readonly now = signal(Date.now());

  protected readonly termsVersion = TERMS_VERSION;
  protected readonly stand = signal<StandView | null>(null);
  protected readonly reservation = signal<ReservationDto | null>(null);
  protected readonly checkout = signal<CheckoutDto | null>(null);
  protected readonly accepted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<FriendlyError | null>(null);
  protected readonly loadError = signal<string | null>(null);

  protected readonly exploreLink = computed(() =>
    this.feria() ? `/feriante/explorar/${this.feria()}` : '/feriante/explorar',
  );
  protected readonly remainingMs = computed(() => {
    const iso = this.reservation()?.holdExpiresAt;
    return iso ? Date.parse(iso) - this.now() : null;
  });
  protected readonly expired = computed(() => {
    const left = this.remainingMs();
    return left !== null && left <= 0;
  });
  protected readonly clockText = computed(() => clock(this.remainingMs() ?? 0));
  /** Announced politely once per minute, not every second. */
  protected readonly announcement = computed(() => {
    const minutes = Math.ceil((this.remainingMs() ?? 0) / 60_000);
    if (minutes <= 0) return '';
    return `Te quedan ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} para pagar.`;
  });
  protected readonly price = formatArs;

  constructor() {
    interval(1000)
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.now.set(Date.now()));
  }

  ngOnInit(): void {
    const resume = this.reserva();
    if (resume) return this.resume(resume);
    const [standId, slug] = [this.stand_(), this.feria()];
    if (!standId || !slug) return void this.loadError.set(STAND_GONE);
    this.catalog.getMap(slug).subscribe({
      next: (map) => {
        const found = standsOf(map).find((s) => s.id === standId);
        if (!found) this.loadError.set(STAND_GONE);
        else if (found.status !== 'AVAILABLE') this.loadError.set(NOT_AVAILABLE);
        else this.stand.set(found);
      },
      error: () => this.loadError.set(LOAD_FAILED),
    });
  }

  protected reserve(stand: StandView): void {
    if (!this.accepted() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.hold(stand.id, TERMS_VERSION, this.holdKey).subscribe({
      next: (reservation) => {
        this.now.set(Date.now());
        this.reservation.set(reservation);
        this.openCheckout(reservation.id);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.error.set(friendly(e));
        // A refused hold is final for this key; a network failure keeps it so a retry replays.
        if (problemOf(e).status !== 0) this.holdKey = crypto.randomUUID();
      },
    });
  }

  protected openCheckout(id: string): void {
    this.busy.set(true);
    this.error.set(null);
    this.payments.checkout(id).subscribe({
      next: (checkout) => {
        this.checkout.set(checkout);
        this.busy.set(false);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.error.set(friendly(e));
      },
    });
  }

  protected cancelHold(id: string): void {
    this.busy.set(true);
    this.api.cancel(id).subscribe({
      next: () => void this.router.navigateByUrl(this.exploreLink()),
      error: (e: unknown) => {
        this.busy.set(false);
        this.error.set(friendly(e));
      },
    });
  }

  private resume(id: string): void {
    this.payments.reservation(id).subscribe({
      next: (reservation) => {
        this.now.set(Date.now());
        this.reservation.set(reservation);
        if (reservation.status === 'HELD' || reservation.status === 'PAYMENT_PENDING')
          this.openCheckout(id);
        else this.loadError.set(NOT_PAYABLE);
      },
      error: () => this.loadError.set(LOAD_FAILED),
    });
  }
}
