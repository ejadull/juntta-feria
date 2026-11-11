import { afterNextRender, type Injector } from '@angular/core';

/** After the next render, moves focus to the first field flagged `aria-invalid` inside `host`. */
export function focusFirstInvalid(injector: Injector, host: HTMLElement): void {
  afterNextRender(() => host.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), {
    injector,
  });
}

export const valueOf = (e: Event): string =>
  (e.target as HTMLInputElement | HTMLSelectElement).value;
