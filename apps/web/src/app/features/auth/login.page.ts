import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { safeReturnUrl } from '../../shared/auth/auth.guard';
import { messageFor } from '../../shared/auth/problem';
import { SessionStore } from '../../shared/auth/session.store';

const ERRORS: Readonly<Record<number, string>> = {
  400: 'Revisá el correo y la contraseña.',
  401: 'El correo o la contraseña no son correctos.',
  429: 'Hiciste demasiados intentos. Esperá unos minutos y volvé a probar.',
  503: 'El ingreso no está disponible por un momento. Probá de nuevo en unos minutos.',
};
const OFFLINE = 'No pudimos conectar con el servidor. Revisá tu conexión y probá de nuevo.';

const valueOf = (event: Event): string => (event.target as HTMLInputElement).value;

/** P01: sign in. `volver` brings the user back to the page that asked for it. */
@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-md px-4 py-10 sm:px-6">
      <p class="text-sm font-semibold tracking-wider text-primary">INGRESAR</p>
      <h1 class="mt-1 text-3xl font-semibold">Entrá a tu cuenta</h1>
      <p class="mt-2 text-text-muted">Usá el correo y la contraseña con los que te registraste.</p>

      <form class="card mt-6 flex flex-col gap-4" (submit)="submit($event)" novalidate>
        <div class="flex flex-col gap-1">
          <label for="email" class="text-sm font-medium">Correo electrónico</label>
          <input
            id="email"
            name="email"
            type="email"
            autocomplete="username"
            required
            class="field"
            [value]="email()"
            [attr.aria-invalid]="error() ? 'true' : null"
            [attr.aria-describedby]="error() ? 'login-error' : null"
            (input)="email.set(valueOf($event))"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label for="password" class="text-sm font-medium">Contraseña</label>
          <input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            class="field"
            [value]="password()"
            [attr.aria-invalid]="error() ? 'true' : null"
            [attr.aria-describedby]="error() ? 'login-error' : null"
            (input)="password.set(valueOf($event))"
          />
        </div>

        @if (error(); as message) {
          <p id="login-error" role="alert" class="rounded-lg bg-danger/10 p-3 text-sm text-text">
            {{ message }}
          </p>
        }

        <button type="submit" class="btn btn-primary justify-center" [disabled]="busy()">
          {{ busy() ? 'Ingresando…' : 'Ingresar' }}
        </button>
      </form>
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
export class LoginPage {
  /** Query param `volver` (withComponentInputBinding); undefined when absent. */
  readonly volver = input<string | undefined>();

  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);

  protected readonly valueOf = valueOf;
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.busy()) return;
    if (!this.email().trim() || !this.password()) {
      this.error.set(ERRORS[400]);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.session.login(this.email().trim(), this.password()).subscribe({
      next: () => void this.router.navigateByUrl(safeReturnUrl(this.volver())),
      error: (e: unknown) => {
        this.busy.set(false);
        this.error.set(messageFor(e, {}, ERRORS, OFFLINE));
      },
    });
  }
}
