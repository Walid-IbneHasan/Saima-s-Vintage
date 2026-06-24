// Progressive enhancement only — the storefront must work without this bundle.
import Alpine from 'alpinejs';
import htmx from 'htmx.org';
import { initHeroShader } from './hero-shader';

declare global {
  interface Window {
    Alpine: typeof Alpine;
    htmx: typeof htmx;
  }
}

window.Alpine = Alpine;
window.htmx = htmx;

Alpine.start();

// ── Progressive polish (Phase 6) ──────────────────────────────────────────
// Signal JS availability so CSS can opt into animations; without this class
// everything stays visible (the storefront is fully usable with JS disabled).
document.documentElement.classList.add('js');

// Hero background shader (no-op unless the home hero canvas is present).
initHeroShader();

// Confirm destructive actions without inline handlers (CSP blocks inline
// `onsubmit`). Any <form data-confirm="message"> prompts before submitting.
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form instanceof HTMLFormElement && form.dataset.confirm) {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  }
});

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
