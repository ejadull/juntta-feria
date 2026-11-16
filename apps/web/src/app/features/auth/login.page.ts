import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { AuthProviders } from '../../shared/auth/auth-providers';
import { AREA_HOME } from '../../shared/auth/area';
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
  imports: [GoogleSignInButton, RouterLink],
  template: `
    <main class="relative isolate flex min-h-screen flex-col bg-background text-text">
      <div class="absolute inset-x-0 top-0 -z-10 h-[60%] overflow-hidden bg-primary" aria-hidden="true">
        <div
          class="absolute top-1/4 -left-40 size-[28rem] rounded-[7rem] border-[3rem] border-on-primary/15"
        ></div>
      </div>

      <div class="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10 sm:px-6">
        <section class="w-full max-w-md rounded-2xl bg-surface p-8 shadow-2xl sm:p-10">
          <div class="flex items-center gap-2 font-bold tracking-wide">
            <span
              class="grid size-9 place-items-center rounded-md bg-primary text-lg font-bold text-on-primary"
              aria-hidden="true"
              >j</span
            >
            <span class="leading-tight">
              <span class="block text-xl font-bold tracking-tight text-primary-strong"
                >juntta<span class="text-secondary" aria-hidden="true">.</span></span
              >
              <span class="block text-[0.6875rem] font-semibold tracking-[0.14em] text-text-muted"
                >FERIAS Y ENCUENTROS</span
              >
            </span>
          </div>

          <hr class="my-6 border-border" />

          <h1 class="text-2xl font-semibold">Te damos la bienvenida</h1>
          <p class="mt-2 text-text-muted">
            Ingresá con tu cuenta de Google para acceder a tu organización o a tus reservas.
          </p>

          @if (googleClientId(); as clientId) {
            <div class="mt-6 flex justify-center">
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

          <p class="mt-6 text-sm text-text-muted">
            ¿No tenés cuenta? Pedile una invitación a tu organizador.
          </p>
          <p class="mt-3 text-xs text-text-muted">
            Al ingresar aceptás los
            <a routerLink="/terminos" class="text-primary-strong underline">Términos y Condiciones</a>
            y la
            <a routerLink="/privacidad" class="text-primary-strong underline"
              >Política de Privacidad</a
            >.
          </p>
        </section>

        <p class="text-center text-sm text-text-muted">
          La plataforma para organizar ferias y encuentros
        </p>
      </div>

      <footer class="pb-6 text-center text-xs text-text-muted">
        &copy; juntta. Ferias y encuentros
      </footer>
    </main>
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
      // Without a (valid) `volver`, each role goes straight to its own home.
      next: () =>
        void this.router.navigateByUrl(
          safeReturnUrl(this.volver(), AREA_HOME[this.session.area()]),
        ),
      error: (e: unknown) => {
        this.busy.set(false);
        this.error.set(messageFor(e, GOOGLE_ERRORS, GOOGLE_STATUS, OFFLINE));
      },
    });
  }
}
