// Pure SVG geometry helpers for the analytics dashboard. No dependencies, no DOM
// — they turn numeric series into ready-to-render coordinates so the template
// stays declarative and there is zero client-side charting JS (CSP-safe).

const r2 = (n: number) => Math.round(n * 100) / 100;

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / pow;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * pow;
}

export interface ComboPoint {
  key: string;
  label: string;
  revenue: number;
  orders: number;
}

export interface ComboChart {
  w: number; h: number;
  padL: number; padR: number; padT: number; padB: number;
  bars: { x: number; y: number; w: number; h: number }[];
  linePoints: string;
  areaPath: string;
  dots: { x: number; y: number; key: string; label: string; revenue: number; orders: number }[];
  yTicks: { y: number; value: number }[];
  xLabels: { x: number; label: string }[];
  maxRevenue: number;
  maxOrders: number;
}

/** Combo: order count as faint bars + revenue as a line/area over the plot. */
export function comboChart(points: ComboPoint[]): ComboChart {
  const w = 760, h = 260, padL = 56, padR = 16, padT = 18, padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const n = Math.max(points.length, 1);

  const maxRevenue = niceMax(Math.max(0, ...points.map((p) => p.revenue)));
  const maxOrders = niceMax(Math.max(0, ...points.map((p) => p.orders)));

  const x = (i: number) =>
    padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yRev = (v: number) => padT + plotH - (v / maxRevenue) * plotH;

  const barW = Math.max(2, Math.min(26, (plotW / n) * 0.5));
  const bars = points.map((p, i) => {
    const bh = (p.orders / maxOrders) * plotH;
    return { x: r2(x(i) - barW / 2), y: r2(padT + plotH - bh), w: r2(barW), h: r2(bh) };
  });

  const dots = points.map((p, i) => ({
    x: r2(x(i)), y: r2(yRev(p.revenue)),
    key: p.key, label: p.label, revenue: p.revenue, orders: p.orders,
  }));

  const linePoints = dots.map((d) => `${d.x},${d.y}`).join(' ');
  const baseline = r2(padT + plotH);
  const areaPath = dots.length
    ? `M ${dots[0].x},${baseline} L ${dots.map((d) => `${d.x},${d.y}`).join(' L ')} L ${dots[dots.length - 1].x},${baseline} Z`
    : '';

  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const value = (maxRevenue / tickCount) * i;
    return { y: r2(yRev(value)), value };
  });

  // Thin x labels so they never overlap (aim for ~8 max).
  const step = Math.max(1, Math.ceil(n / 8));
  const xLabels = points
    .map((p, i) => ({ x: r2(x(i)), label: p.label, i }))
    .filter((p) => p.i % step === 0 || p.i === n - 1)
    .map(({ x, label }) => ({ x, label }));

  return { w, h, padL, padR, padT, padB, bars, linePoints, areaPath, dots, yTicks, xLabels, maxRevenue, maxOrders };
}

export interface BarChart {
  w: number; h: number; padT: number; padB: number; baseline: number;
  bars: { x: number; y: number; w: number; h: number; value: number; label: string; peak: boolean }[];
  xLabels: { x: number; label: string }[];
  max: number;
}

/** Vertical bar chart (peak hour / weekday). `labelEvery` thins x labels. */
export function barChart(
  series: { label: string; value: number }[],
  opts: { w?: number; h?: number; labelEvery?: number } = {},
): BarChart {
  const w = opts.w ?? 760;
  const h = opts.h ?? 200;
  const padT = 14, padB = 24, padX = 8;
  const plotH = h - padT - padB;
  const n = Math.max(series.length, 1);
  const slot = (w - padX * 2) / n;
  const barW = Math.max(3, slot * 0.62);
  const max = niceMax(Math.max(1, ...series.map((s) => s.value)));
  const peakVal = Math.max(...series.map((s) => s.value));
  const baseline = padT + plotH;
  const labelEvery = opts.labelEvery ?? 1;

  const bars = series.map((s, i) => {
    const bh = (s.value / max) * plotH;
    const cx = padX + slot * i + slot / 2;
    return {
      x: r2(cx - barW / 2), y: r2(baseline - bh), w: r2(barW), h: r2(bh),
      value: s.value, label: s.label, peak: s.value > 0 && s.value === peakVal,
    };
  });

  const xLabels = series
    .map((s, i) => ({ x: r2(padX + slot * i + slot / 2), label: s.label, i }))
    .filter((s) => s.i % labelEvery === 0)
    .map(({ x, label }) => ({ x, label }));

  return { w, h, padT, padB, baseline: r2(baseline), bars, xLabels, max };
}

export interface DonutSegment {
  label: string; value: number; color: string;
}
export interface Donut {
  size: number; cx: number; cy: number; r: number; inner: number; total: number;
  arcs: { d: string; color: string; label: string; value: number; pct: number }[];
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r2(cx + r * Math.cos(a)), r2(cy + r * Math.sin(a))];
}

/** Donut chart from labelled segments. */
export function donut(segments: DonutSegment[], size = 180): Donut {
  const cx = size / 2, cy = size / 2, r = size / 2 - 6, inner = r * 0.62;
  const total = segments.reduce((s, x) => s + x.value, 0);
  const arcs: Donut['arcs'] = [];
  let start = 0;
  for (const seg of segments) {
    if (seg.value <= 0 || total <= 0) continue;
    const sweep = (seg.value / total) * 360;
    let end = start + sweep;
    if (end - start >= 360) end = start + 359.99; // avoid a zero-length full circle
    const large = end - start > 180 ? 1 : 0;
    const [x1, y1] = polar(cx, cy, r, end);
    const [x2, y2] = polar(cx, cy, r, start);
    const [x3, y3] = polar(cx, cy, inner, start);
    const [x4, y4] = polar(cx, cy, inner, end);
    const d = `M ${x1} ${y1} A ${r2(r)} ${r2(r)} 0 ${large} 0 ${x2} ${y2} L ${x3} ${y3} A ${r2(inner)} ${r2(inner)} 0 ${large} 1 ${x4} ${y4} Z`;
    arcs.push({ d, color: seg.color, label: seg.label, value: seg.value, pct: Math.round((seg.value / total) * 100) });
    start = end;
  }
  return { size, cx, cy, r: r2(r), inner: r2(inner), total, arcs };
}
