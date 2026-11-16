import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';

const pathOf = (url: string): string => url.split(/[?#]/)[0];
const RESTORE_FRAMES = 30;

/**
 * What a full page load does and a single-page app does not, done by hand after each navigation:
 * scroll to the top of the new page (or back to where the user was on back/forward) and move focus
 * to its heading so keyboard and screen reader users start from the new content. The shell's
 * `<main id="main">` is the scroll container; other pages scroll the window.
 */
@Injectable({ providedIn: 'root' })
export class RouteEffects {
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly positions = new Map<string, number>();
  private currentUrl: string | null = null;
  private isHistoryTraversal = false;
  private started = false;

  /** Idempotent: starts listening to the router. The first navigation never moves focus. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        if (this.currentUrl !== null) this.positions.set(this.currentUrl, this.scrollTop());
        this.isHistoryTraversal = event.navigationTrigger === 'popstate';
      } else if (event instanceof NavigationEnd) {
        this.settle(event.urlAfterRedirects);
      } else if (event instanceof NavigationCancel || event instanceof NavigationError) {
        this.isHistoryTraversal = false;
      }
    });
  }

  private settle(url: string): void {
    const previous = this.currentUrl;
    const traversal = this.isHistoryTraversal;
    this.currentUrl = url;
    this.isHistoryTraversal = false;
    // First load, or only the query/fragment changed: leave scroll and focus alone.
    if (previous === null || pathOf(previous) === pathOf(url)) return;

    const saved = this.positions.get(url);
    if (traversal && saved !== undefined) this.restore(saved);
    else this.setScrollTop(0);
    setTimeout(() => this.focusPage(), 0);
  }

  private scroller(): HTMLElement | null {
    return this.doc.getElementById('main');
  }

  private scrollTop(): number {
    return this.scroller()?.scrollTop ?? this.doc.defaultView?.scrollY ?? 0;
  }

  private setScrollTop(top: number): void {
    const scroller = this.scroller();
    if (scroller) scroller.scrollTop = top;
    else this.doc.defaultView?.scrollTo(0, top);
  }

  /** Lazy pages render after the navigation ends, so wait until the content is tall enough. */
  private restore(top: number, frame = 0): void {
    this.setScrollTop(top);
    const reached = this.scrollTop() >= top - 1;
    const view = this.doc.defaultView;
    if (reached || frame >= RESTORE_FRAMES || !view) return;
    view.requestAnimationFrame(() => this.restore(top, frame + 1));
  }

  private focusPage(): void {
    const main = this.doc.querySelector<HTMLElement>('main');
    const target = main?.querySelector<HTMLElement>('h1') ?? main;
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
}
