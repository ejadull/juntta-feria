import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RouteEffects } from './shared/route-effects';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private readonly doc = inject(DOCUMENT);

  constructor() {
    inject(RouteEffects).start();
  }

  /** The skip link jumps to the page's <main> without touching the URL (the app uses <base href>). */
  protected skipToContent(event: Event): void {
    const main = this.doc.getElementById('main') ?? this.doc.querySelector<HTMLElement>('main');
    if (!main) return;
    event.preventDefault();
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    main.focus();
  }
}
