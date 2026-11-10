import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AuthProviders } from '../../shared/auth/auth-providers';
import { safeReturnUrl } from '../../shared/auth/auth.guard';
import { messageFor } from '../../shared/auth/problem';
import { SessionStore } from '../../shared/auth/session.store';
import { GoogleSignInButton } from '../../shared/google-sign-in';

/** Machine codes of `POST /auth/google` (CORE-05). */
const GOOGLE_ERRORS: Readonly<Record<string, string>> = {
  GOOGLE_ACCOUNT_NOT_REGISTERED:
    'No encontramos una cuenta con ese email. Pedile una invitación al organizador.',
  GOOGLE_ACCOUNT_MISMATCH:
    'Esa cuenta ya está vinculada a otra cuenta de Google. Ingresá con la que usaste antes.',
  GOOGLE_CREDENTIAL_INVALID: 'No pudimos verificar tu cuenta de Google. Probá de nuevo.',
  GOOGLE_SIGN_IN_UNAVAILABLE:
    'Ingresar con Google no está disponible por ahora. Probá de nuevo en unos minutos.',
};
const GOOGLE_STATUS: Readonly<Record<number, string>> = {
  429: 'Hiciste demasiados intentos. Esperá unos minutos y volvé a probar.',
  503: GOOGLE_ERRORS['GOOGLE_SIGN_IN_UNAVAILABLE'],
};
const OFFLINE = 'No pudimos conectar con el servidor. Revisá tu conexión y probá de nuevo.';

/** P01: sign in with Google (the only way in, ADR 0008). `volver` brings the user back. */
@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GoogleSignInButton],
  template: `
    <section class="mx-auto max-w-md px-4 py-10 sm:px-6">
      <p class="text-sm font-semibold tracking-wider text-primary">INGRESAR</p>
      <h1 class="mt-1 text-3xl font-semibold">Entrá a tu cuenta</h1>
      <p class="mt-2 text-text-muted">
        Entrá con tu cuenta de Google. Si todavía no tenés cuenta, pedile la invitación al
        organizador.
      </p>

      @if (googleClientId(); as clientId) {
        <div class="mt-6">
          <app-google-sign-in-button
            [clientId]="clientId"
            label="Ingresar con Google"
            (credential)="signInWithGoogle($event)"
          />
        </div>
      } @else if (googleClientId() === null) {
        <p role="alert" class="mt-6 rounded-lg bg-danger/10 p-3 text-sm text-text">
          {{ unavailable }}
        </p>
      }

      @if (error(); as message) {
        <p role="alert" class="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-text">
          {{ message }}
        </p>
      }
    </section>
  `,
})
export class LoginPage {
  /** Query param `volver` (withComponentInputBinding); undefined when absent. */
  readonly volver = input<string | undefined>();

  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);

  /** Undefined while the API answers; null when Google sign-in is not configured. */
  protected readonly googleClientId = toSignal(inject(AuthProviders).googleClientId$);
  protected readonly unavailable = GOOGLE_ERRORS['GOOGLE_SIGN_IN_UNAVAILABLE'];
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
}
