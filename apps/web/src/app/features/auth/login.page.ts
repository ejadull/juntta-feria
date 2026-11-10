import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AuthProviders } from '../../shared/auth/auth-providers';
import { safeReturnUrl } from '../../shared/auth/auth.guard';
import { messageFor } from '../../shared/auth/problem';
import { SessionStore } from '../../shared/auth/session.store';
import { GoogleSignInButton } from '../../shared/google-sign-in';

const ERRORS: Readonly<Record<number, string>> = {
  400: 'Revisá el correo y la contraseña.',
  401: 'El correo o la contraseña no son correctos.',
  429: 'Hiciste demasiados intentos. Esperá unos minutos y volvé a probar.',
  503: 'El ingreso no está disponible por un momento. Probá de nuevo en unos minutos.',
};
/** Machine codes of `POST /auth/google` (CORE-05). */
const GOOGLE_ERRORS: Readonly<Record<string, string>> = {
  GOOGLE_ACCOUNT_NOT_REGISTERED:
    'No encontramos una cuenta con ese email. Pedile una invitación al organizador.',
  GOOGLE_ACCOUNT_MISMATCH:
    'Esa cuenta ya está vinculada a otra cuenta de Google. Ingresá con la que usaste antes o con tu correo y contraseña.',
  GOOGLE_CREDENTIAL_INVALID: 'No pudimos verificar tu cuenta de Google. Probá de nuevo.',
  GOOGLE_SIGN_IN_UNAVAILABLE:
    'Ingresar con Google no está disponible por ahora. Usá tu correo y contraseña.',
};
const GOOGLE_STATUS: Readonly<Record<number, string>> = {
  429: ERRORS[429],
  503: GOOGLE_ERRORS['GOOGLE_SIGN_IN_UNAVAILABLE'],
};
const OFFLINE = 'No pudimos conectar con el servidor. Revisá tu conexión y probá de nuevo.';

const valueOf = (event: Event): string => (event.target as HTMLInputElement).value;

/** P01: sign in. `volver` brings the user back to the page that asked for it. */
@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GoogleSignInButton],
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

      @if (googleClientId(); as clientId) {
        <div class="mt-6 flex items-center gap-3 text-sm text-text-muted" aria-hidden="true">
          <span class="h-px flex-1 bg-border-strong"></span>
          <span>o</span>
          <span class="h-px flex-1 bg-border-strong"></span>
        </div>
        <div class="mt-6">
          <app-google-sign-in-button
            [clientId]="clientId"
            label="Ingresar con Google"
            (credential)="signInWithGoogle($event)"
          />
        </div>
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
export class LoginPage {
  /** Query param `volver` (withComponentInputBinding); undefined when absent. */
  readonly volver = input<string | undefined>();

  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);

  /** Null until the API says Google sign-in is configured: then the button shows up. */
  protected readonly googleClientId = toSignal(inject(AuthProviders).googleClientId$, {
    initialValue: null,
  });

  protected readonly valueOf = valueOf;
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected signInWithGoogle(credential: string): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.session.loginWithGoogle(credential).subscribe({
      next: () => void this.router.navigateByUrl(safeReturnUrl(this.volver())),
      error: (e: unknown) => {
        this.busy.set(false);
        this.error.set(messageFor(e, GOOGLE_ERRORS, GOOGLE_STATUS, OFFLINE));
      },
    });
  }

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
