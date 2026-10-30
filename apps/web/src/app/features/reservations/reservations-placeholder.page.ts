import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** P10/P12 placeholder (design D5): explains the dependency instead of showing simulated payments. */
@Component({
  selector: 'app-reservations-placeholder-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-3xl px-6 py-10">
      <p class="text-sm font-semibold tracking-wider text-primary">ORGANIZADOR</p>
      <h1 class="mt-1 text-3xl font-semibold">Reservas y cobros</h1>
      <p class="mt-3 text-text-muted">
        Esta sección todavía no está disponible. Va a mostrar las reservas del evento por estado
        (retenidas, pendientes de pago, confirmadas, vencidas), la conciliación con Mercado Pago,
        los pagos tardíos y los reembolsos.
      </p>

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

      <a routerLink="/organizador/panel" class="btn mt-6">Volver al panel</a>
    </section>
  `,
})
export class ReservationsPlaceholderPage {}
