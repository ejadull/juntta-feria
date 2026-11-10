import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  InjectionToken,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import {
  PaymentAccountRepository,
  type SellerAccountDto,
  type SellerAccountStatus,
} from './data/payment-account.repository';

/** Leaves the app for the provider's authorization page. A token so tests never navigate. */
export const EXTERNAL_NAVIGATION = new InjectionToken<(url: string) => void>('ExternalNavigation', {
  providedIn: 'root',
  factory: () => (url: string) => window.location.assign(url),
});

const STATUS: Record<SellerAccountStatus, { label: string; icon: string; tone: string }> = {
  NOT_LINKED: { label: 'Sin vincular', icon: '○', tone: 'bg-surface-soft' },
  LINKED: { label: 'Vinculada', icon: '✓', tone: 'bg-available/15' },
  EXPIRED: { label: 'Vencida', icon: '!', tone: 'bg-danger/10' },
};

const ENVIRONMENT = { sandbox: 'Pruebas (sandbox)', production: 'Producción' } as const;

const LOAD_FAILED = 'No pudimos cargar el estado de la cuenta. Probá de nuevo en unos minutos.';
const LINK_FAILED = 'No pudimos iniciar la vinculación con Mercado Pago. Probá de nuevo.';
const UNLINK_FAILED = 'No pudimos desvincular la cuenta. Probá de nuevo.';

/**
 * P12 (PAY-07): the organization's Mercado Pago seller account. Shows link state and
 * environment, never a token; linking goes through Mercado Pago's own authorization page.
 */
@Component({
  selector: 'app-payment-account-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-sm font-semibold tracking-wider text-primary">ORGANIZADOR</p>
          <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Mercado Pago</h1>
        </div>
        <span class="rounded-full bg-reserved/15 px-3 py-1 text-xs font-medium text-text">
          Datos de demostración
        </span>
      </header>
      <p class="mt-3 text-text-muted">
        Los pagos de las reservas entran directo en la cuenta de Mercado Pago de tu organización. La
        vinculás vos desde Mercado Pago: Juntta nunca ve tu contraseña.
      </p>

      @if (error(); as message) {
        <p role="alert" class="mt-6 rounded-xl bg-danger/10 p-4 text-text">{{ message }}</p>
      }

      @if (account(); as a) {
        <section class="card mt-6" aria-labelledby="account-heading">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 id="account-heading" class="text-lg font-semibold">Cuenta vendedora</h2>
            <span
              class="status rounded-full px-3 py-1 text-sm text-text"
              [class]="status[a.status].tone"
            >
              <span aria-hidden="true">{{ status[a.status].icon }}</span>
              {{ status[a.status].label }}
            </span>
          </div>

          <dl class="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-text-muted">Entorno</dt>
              <dd class="font-medium">{{ environment[a.environment] }}</dd>
            </div>
            @if (a.sellerId) {
              <div>
                <dt class="text-text-muted">ID de vendedor</dt>
                <dd class="font-medium">{{ a.sellerId }}</dd>
              </div>
            }
            @if (a.linkedAt) {
              <div>
                <dt class="text-text-muted">Vinculada el</dt>
                <dd class="font-medium">{{ day(a.linkedAt) }}</dd>
              </div>
            }
            @if (a.expiresAt) {
              <div>
                <dt class="text-text-muted">Autorización válida hasta</dt>
                <dd class="font-medium">{{ day(a.expiresAt) }}</dd>
              </div>
            }
          </dl>

          @if (a.status === 'EXPIRED') {
            <p role="alert" class="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-text">
              La autorización venció y los cobros están frenados. Revinculá la cuenta para seguir
              cobrando.
            </p>
          }

          <div class="mt-5 flex flex-wrap gap-2">
            @if (a.status === 'NOT_LINKED') {
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="link()">
                Vincular cuenta de Mercado Pago
              </button>
            } @else {
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="link()">
                Revincular
              </button>
              <button
                type="button"
                class="btn btn-danger"
                [disabled]="busy() || confirming()"
                (click)="askUnlink()"
              >
                Desvincular
              </button>
            }
          </div>

          @if (confirming()) {
            <div
              role="alertdialog"
              aria-labelledby="unlink-title"
              aria-describedby="unlink-text"
              class="mt-4 rounded-lg border border-border-strong p-4"
            >
              <p id="unlink-title" class="font-semibold">¿Desvincular la cuenta?</p>
              <p id="unlink-text" class="mt-1 text-sm text-text-muted">
                Las reservas nuevas no se van a poder pagar hasta que vincules una cuenta otra vez.
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="unlink()">
                  Sí, desvincular
                </button>
                <button #cancel type="button" class="btn" (click)="confirming.set(false)">
                  Cancelar
                </button>
              </div>
            </div>
          }
        </section>
      }
    </div>
  `,
})
export class PaymentAccountPage {
  private readonly repository = inject(PaymentAccountRepository);
  private readonly navigate = inject(EXTERNAL_NAVIGATION);
  private readonly injector = inject(Injector);
  private readonly cancel = viewChild<ElementRef<HTMLButtonElement>>('cancel');

  protected readonly status = STATUS;
  protected readonly environment = ENVIRONMENT;
  protected readonly account = signal<SellerAccountDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirming = signal(false);

  constructor() {
    this.load();
  }

  protected link(): void {
    this.busy.set(true);
    this.error.set(null);
    this.repository.startLink().subscribe({
      next: (url) => this.navigate(url),
      error: () => {
        this.busy.set(false);
        this.error.set(LINK_FAILED);
      },
    });
  }

  protected askUnlink(): void {
    this.confirming.set(true);
    // The safe choice gets the focus, as in a native confirm.
    afterNextRender(() => this.cancel()?.nativeElement.focus(), { injector: this.injector });
  }

  protected unlink(): void {
    this.busy.set(true);
    this.repository.unlink().subscribe({
      next: () => {
        this.confirming.set(false);
        this.busy.set(false);
        this.load();
      },
      error: () => {
        this.busy.set(false);
        this.error.set(UNLINK_FAILED);
      },
    });
  }

  protected day(iso: string): string {
    return new Date(iso).toLocaleDateString('es-AR');
  }

  private load(): void {
    this.repository.status().subscribe({
      next: (account) => this.account.set(account),
      error: () => this.error.set(LOAD_FAILED),
    });
  }
}
