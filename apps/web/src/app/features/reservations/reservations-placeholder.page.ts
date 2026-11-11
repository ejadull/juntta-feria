import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Reservation/payment placeholder (org-ui-shell D5, pub-ui-catalog D1): explains the dependency
 * instead of showing simulated payments. Texts come from route data (withComponentInputBinding).
 */
@Component({
  selector: 'app-reservations-placeholder-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-3xl px-6 py-10">
      <p class="text-sm font-semibold tracking-wider text-primary-strong">{{ eyebrow() }}</p>
      <h1 class="mt-1 text-3xl font-semibold">{{ heading() }}</h1>
      <p class="mt-3 text-text-muted">Esta sección todavía no está disponible. {{ intro() }}</p>

      <div
        class="mt-6 rounded-xl border border-reserved-stroke/50 bg-reserved/15 p-4 text-sm text-text"
      >
        <h2 class="font-semibold">Por qué no hay datos de ejemplo</h2>
        <p class="mt-1">
          Depende de <strong>RES-01</strong> (reservas con hold, concurrencia e idempotencia) y
          <strong>PAY-01</strong> (Checkout Pro, webhooks y conciliación). Simular reservas o pagos
          fijaría un contrato que todavía no está diseñado, en la parte más delicada del producto.
        </p>
      </div>

      <a [routerLink]="backLink()" class="btn mt-6">{{ backLabel() }}</a>
    </section>
  `,
})
export class ReservationsPlaceholderPage {
  // Required: withComponentInputBinding sets inputs missing from the route to undefined,
  // so defaults would be silently lost. Every route passes all of them in `data`.
  readonly eyebrow = input.required<string>();
  readonly heading = input.required<string>();
  readonly intro = input.required<string>();
  readonly backLink = input.required<string>();
  readonly backLabel = input.required<string>();
}
