import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { RouteEffects } from './route-effects';

@Component({ template: '<h1>Uno</h1>' })
class One {}
@Component({ template: '<h1>Dos</h1>' })
class Two {}
@Component({
  imports: [RouterOutlet],
  template: '<main id="main"><router-outlet /></main>',
})
class Host {}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('RouteEffects', () => {
  let router: Router;
  let top = 0;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'uno', component: One },
          { path: 'dos', component: Two },
        ]),
      ],
    });
    router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    const main = (fixture.nativeElement as HTMLElement).querySelector('main')!;
    top = 0;
    // jsdom does not scroll: back scrollTop with a variable.
    Object.defineProperty(main, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => (top = value),
    });
    TestBed.inject(RouteEffects).start();
    await router.navigateByUrl('/uno');
    await settle();
  });

  afterEach(() => document.body.replaceChildren());

  it('does not move focus on the first load', () => {
    expect(document.activeElement).toBe(document.body);
  });

  it('scrolls main to the top and focuses the new heading on a new path', async () => {
    top = 300;
    await router.navigateByUrl('/dos');
    await settle();
    expect(top).toBe(0);
    expect(document.activeElement?.tagName).toBe('H1');
    expect(document.activeElement?.textContent).toBe('Dos');
  });

  it('ignores query-only changes', async () => {
    top = 300;
    await router.navigateByUrl('/uno?x=1');
    await settle();
    expect(top).toBe(300);
    expect(document.activeElement).toBe(document.body);
  });
});
