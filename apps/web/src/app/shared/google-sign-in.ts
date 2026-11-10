import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  InjectionToken,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** Google Identity Services, loaded on demand (CORE-05, ADR 0008). */
const GIS_URL = 'https://accounts.google.com/gsi/client';

export type GoogleButtonText = 'signin_with' | 'continue_with';

export interface GoogleButtonOptions {
  readonly clientId: string;
  readonly text: GoogleButtonText;
  /** Called with the ID token (`credential`) once the user picks an account. */
  readonly onCredential: (credential: string) => void;
}

interface GisApi {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
      }): void;
      renderButton(container: HTMLElement, options: object): void;
    };
  };
}

let gis: Promise<GisApi> | undefined;

/** Loads the GIS script once per page; a failed load is retried on the next call. */
function loadGis(): Promise<GisApi> {
  gis ??= new Promise<GisApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_URL;
    script.async = true;
    script.onload = () => {
      const api = (window as { google?: GisApi }).google;
      if (api?.accounts?.id) resolve(api);
      else reject(new Error('Google Identity Services missing'));
    };
    script.onerror = () => reject(new Error('Google Identity Services blocked'));
    document.body.append(script);
  }).catch((error: unknown) => {
    gis = undefined;
    throw error;
  });
  return gis;
}

/** Renders Google's button in a container. A token so tests never load the real script. */
export const GOOGLE_SIGN_IN = new InjectionToken<
  (container: HTMLElement, options: GoogleButtonOptions) => Promise<void>
>('GoogleSignIn', {
  providedIn: 'root',
  factory:
    () =>
    async (container, { clientId, text, onCredential }) => {
      const api = await loadGis();
      api.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response.credential) onCredential(response.credential);
        },
      });
      api.accounts.id.renderButton(container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text,
        locale: 'es-419',
        width: 320,
      });
    },
});

/**
 * "Ingresar con Google" / "Continuar con Google". Google draws the button inside an iframe, so the
 * container is a labelled group; the form next to it stays fully usable if the script is blocked,
 * in which case nothing is shown.
 */
@Component({
  selector: 'app-google-sign-in-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #host
      role="group"
      class="flex min-h-11 justify-center"
      [attr.aria-label]="label()"
      [hidden]="failed()"
    ></div>
  `,
})
export class GoogleSignInButton {
  readonly clientId = input.required<string>();
  readonly text = input<GoogleButtonText>('signin_with');
  /** Accessible name of the group that holds Google's iframe. */
  readonly label = input('Ingresar con Google');
  readonly credential = output<string>();

  private readonly render = inject(GOOGLE_SIGN_IN);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  protected readonly failed = signal(false);

  constructor() {
    afterNextRender(() => {
      this.render(this.host().nativeElement, {
        clientId: this.clientId(),
        text: this.text(),
        onCredential: (credential) => this.credential.emit(credential),
      }).catch(() => this.failed.set(true));
    });
  }
}
