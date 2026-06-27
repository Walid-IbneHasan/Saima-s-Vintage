/*
 * Premium home-page micro-interactions ("Maison Rouge" redesign).
 *
 * Progressive enhancement, scoped to the home page only: everything here no-ops
 * unless an element with [data-lux] exists, and all motion respects
 * prefers-reduced-motion. Bundled through main.ts (not inline) so it satisfies
 * the strict CSP. The page is fully usable and beautiful with this disabled.
 */
export function initLuxHome(): void {
  const root = document.querySelector<HTMLElement>('[data-lux]');
  if (!root) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── 1. Count-up stats when they scroll into view ─────────────────────────
  const counters = root.querySelectorAll<HTMLElement>('[data-countup]');
  if (counters.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          obs.unobserve(entry.target);
          const el = entry.target as HTMLElement;
          const target = Number(el.dataset.countup || '0');
          const suffix = el.dataset.suffix || '';
          if (reduce || !Number.isFinite(target)) {
            el.textContent = `${target}${suffix}`;
            continue;
          }
          const duration = 1500;
          const startTime = performance.now();
          const step = (now: number) => {
            const t = Math.min(1, (now - startTime) / duration);
            const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
            el.textContent = `${Math.round(target * eased)}${suffix}`;
            if (t < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      },
      { rootMargin: '0px 0px -15% 0px' },
    );
    counters.forEach((c) => io.observe(c));
  }

  // ── 2. Hero pointer parallax (fine pointer / desktop only) ───────────────
  if (!reduce && window.matchMedia('(pointer: fine)').matches) {
    const scene = root.querySelector<HTMLElement>('[data-parallax-scene]');
    if (scene) {
      const layers = Array.from(
        scene.querySelectorAll<HTMLElement>('[data-depth]'),
      );
      let raf = 0;
      let nx = 0;
      let ny = 0;
      const apply = () => {
        raf = 0;
        for (const layer of layers) {
          const depth = Number(layer.dataset.depth || '0');
          layer.style.transform = `translate3d(${(-nx * depth).toFixed(
            2,
          )}px, ${(-ny * depth).toFixed(2)}px, 0)`;
        }
      };
      scene.addEventListener('pointermove', (ev: PointerEvent) => {
        const r = scene.getBoundingClientRect();
        nx = (ev.clientX - (r.left + r.width / 2)) / r.width; // -0.5..0.5
        ny = (ev.clientY - (r.top + r.height / 2)) / r.height;
        if (!raf) raf = requestAnimationFrame(apply);
      });
      scene.addEventListener('pointerleave', () => {
        for (const layer of layers) layer.style.transform = '';
      });
    }
  }
}
