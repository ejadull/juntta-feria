import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
  type OnInit,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PaymentAccountRepository } from './data/payment-account.repository';

type Problem = 'invalid' | 'cancelled' | 'failed';

const MESSAGES: Record<Problem, string> = {
  invalid: 'La autorización no es válida o venció. Volvé a vincular la cuenta desde el principio.',
  cancelled: 'Cancelaste la autorización en Mercado Pago. La cuenta no se vinculó.',
  failed: 'No pudimos completar la vinculación. Probá de nuevo en unos minutos.',
};

export const P12 = '/organizador/mercado-pago';

/**
 * Return from Mercado Pago's authorization (PAY-07, `MP_OAUTH_REDIRECT_URI`). The query params
 * only feed the API call: the API checks that `state` belongs to this organization and user.
 */
@Component({
  selector: 'app-payment-account-return-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <p class="text-sm font-semibold tracking-wider text-primary-strong">ORGANIZADOR</p>
      <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Vincular Mercado Pago</h1>
      @if (problem(); as p) {
        <p role="alert" class="mt-6 rounded-xl bg-danger/10 p-4 text-text">{{ messages[p] }}</p>
        <a class="btn mt-4" [routerLink]="p12">Volver a Mercado Pago</a>
      } @else {
        <p role="status" class="mt-6 text-text-muted">Vinculando tu cuenta…</p>
      }
    </div>
  `,
})
export class PaymentAccountReturnPage implements OnInit {
  readonly code = input<string>();
  readonly state = input<string>();
  /** Mercado Pago sends `error` (e.g. access_denied) when the organizer declines. */
  readonly error = input<string>();

  private readonly repository = inject(PaymentAccountRepository);
  private readonly router = inject(Router);
  protected readonly messages = MESSAGES;
  protected readonly p12 = P12;
  protected readonly problem = signal<Problem | null>(null);

  ngOnInit(): void {
    if (this.error()) return this.problem.set('cancelled');
    const code = this.code();
    const state = this.state();
    if (!code || !state) return this.problem.set('invalid');
    this.repository.completeLink(code, state).subscribe({
      next: () => void this.router.navigateByUrl(P12),
      error: (e: unknown) =>
        this.problem.set(
          e instanceof Error && e.message === 'INVALID_OAUTH_STATE' ? 'invalid' : 'failed',
        ),
    });
  }
}
