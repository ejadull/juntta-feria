import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-xl px-6 py-16 text-center">
      <h1 class="text-2xl font-semibold">Página no encontrada</h1>
      <p class="mt-2 text-text-muted">La dirección no existe o cambió.</p>
      <a routerLink="/organizador/panel" class="btn btn-primary mt-6">Ir al panel</a>
    </section>
  `,
})
export class NotFoundPage {}
