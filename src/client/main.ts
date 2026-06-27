// Progressive enhancement only — the storefront must work without this bundle.
import Alpine from 'alpinejs';
import htmx from 'htmx.org';
import { initHeroShader } from './hero-shader';
import { initLuxHome } from './lux-home';

declare global {
  interface Window {
    Alpine: typeof Alpine;
    htmx: typeof htmx;
  }
}

window.Alpine = Alpine;
window.htmx = htmx;

Alpine.start();

// The ESM build of htmx doesn't always auto-process when imported after
// DOMContentLoaded (module scripts are deferred), so wire up hx-* attributes
// explicitly. Idempotent — safe even if htmx already initialised.
htmx.process(document.body);

// ── Progressive polish (Phase 6) ──────────────────────────────────────────
// Signal JS availability so CSS can opt into animations; without this class
// everything stays visible (the storefront is fully usable with JS disabled).
document.documentElement.classList.add('js');

// Hero background shader (no-op unless the home hero canvas is present).
initHeroShader();

// Premium home-page micro-interactions (no-op unless [data-lux] is present).
initLuxHome();

// Confirm destructive actions without inline handlers (CSP blocks inline
// `onsubmit`). Any <form data-confirm="message"> prompts before submitting.
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form instanceof HTMLFormElement && form.dataset.confirm) {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  }
});

// Preserve scroll position across a form POST→redirect that lands back on the
// same path (e.g. adding a variant or saving on the admin product edit page),
// so the page stays exactly where it was instead of jumping to the top.
// Auto-enabled on the product edit screen; opt in elsewhere with data-keep-scroll.
const keepScrollHere = /^\/admin\/products\/[^/]+\/edit$/.test(location.pathname);
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (
    form instanceof HTMLFormElement &&
    !event.defaultPrevented &&
    (keepScrollHere || form.hasAttribute('data-keep-scroll'))
  ) {
    try {
      sessionStorage.setItem(
        'keepScroll',
        JSON.stringify({ p: location.pathname, y: window.scrollY }),
      );
    } catch {
      /* sessionStorage unavailable — fall back to default scroll */
    }
  }
});
try {
  const raw = sessionStorage.getItem('keepScroll');
  if (raw) {
    sessionStorage.removeItem('keepScroll');
    const { p, y } = JSON.parse(raw) as { p: string; y: number };
    if (p === location.pathname && typeof y === 'number') {
      window.scrollTo(0, y);
    }
  }
} catch {
  /* ignore malformed/absent state */
}

const prefersReducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)',
).matches;

if (!prefersReducedMotion && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  document
    .querySelectorAll('[data-reveal], [data-reveal-stagger]')
    .forEach((el) => observer.observe(el));
} else {
  // Reduced motion (or no IO support): reveal everything immediately.
  document
    .querySelectorAll('[data-reveal], [data-reveal-stagger]')
    .forEach((el) => el.classList.add('is-visible'));
}

/*
 * 3D model hook (lazy, opt-in): if a page includes an element with
 * [data-model-src], the heavy <model-viewer> web component is dynamically
 * imported only when it scrolls into view. No 3D code ships otherwise.
 * (Add `@google/model-viewer` and a Product.model3dUrl field to enable.)
 */
const modelHost = document.querySelector<HTMLElement>('[data-model-src]');
if (modelHost && 'IntersectionObserver' in window) {
  const once = new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) {
      obs.disconnect();
      // import('@google/model-viewer').then(() => { ...mount... });
      modelHost.setAttribute('data-model-ready', 'true');
    }
  });
  once.observe(modelHost);
}
