import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// ─────────────────────────────────────────────────────────────────────────────
// Analytics aggregation. Everything is computed in SQL (GROUP BY / conditional
// SUM) — never by looping rows in JS — and the whole payload is cached in-memory
// for a short TTL so repeated dashboard loads don't re-hit the database. All
// time bucketing is converted to Bangladesh local time (UTC+6) so "peak hour",
// daily revenue, etc. read in the store's own timezone.
// ─────────────────────────────────────────────────────────────────────────────

const SOLD = "('PAID','PROCESSING','SHIPPED','DELIVERED')";
const TZ = '+06:00'; // Bangladesh (no DST). Rows are stored UTC by Prisma.
const SALE_TS = `CONVERT_TZ(COALESCE(paidAt, placedAt), '+00:00', '${TZ}')`;
const PLACED_TS = `CONVERT_TZ(placedAt, '+00:00', '${TZ}')`;

export type RangeKey = '7d' | '30d' | '12w' | '12m';

interface RangeConfig {
  key: RangeKey;
  label: string;
  bucket: 'day' | 'week' | 'month';
  units: number; // number of buckets
}

const RANGES: Record<RangeKey, RangeConfig> = {
  '7d': { key: '7d', label: 'Last 7 days', bucket: 'day', units: 7 },
  '30d': { key: '30d', label: 'Last 30 days', bucket: 'day', units: 30 },
  '12w': { key: '12w', label: 'Last 12 weeks', bucket: 'week', units: 12 },
  '12m': { key: '12m', label: 'Last 12 months', bucket: 'month', units: 12 },
};

export interface Kpi {
  value: number;
  prev: number;
  deltaPct: number | null; // null when prev is 0
}

export interface TrendPoint {
  key: string; // bucket key (YYYY-MM-DD)
  label: string; // human label (e.g. "12 Jun", "Wk 24", "Jun")
  revenue: number;
  orders: number;
}

export interface AnalyticsDashboard {
  range: { key: RangeKey; label: string; bucket: string };
  ranges: { key: RangeKey; label: string }[];
  kpis: {
    revenue: Kpi;
    orders: Kpi;
    aov: Kpi;
    customers: Kpi;
  };
  paidRate: number; // % of orders placed in period that became a sale
  trend: TrendPoint[];
  peakHours: { hour: number; orders: number }[]; // 0..23
  peakHour: { hour: number; orders: number } | null;
  weekdays: { day: number; label: string; orders: number; revenue: number }[]; // 1=Sun..7=Sat
  peakDay: { label: string; orders: number } | null;
  statusBreakdown: { status: string; label: string; count: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
  topCategories: { name: string; revenue: number; quantity: number }[];
  ops: {
    awaitingPayment: number;
    paymentReview: number;
    processing: number;
    shipped: number;
    lowStock: number;
  };
  recentOrders: {
    orderNumber: string;
    placedAt: Date;
    email: string;
    grandTotal: number;
    status: string;
    currency: string;
  }[];
  generatedAt: Date;
}

// Kept for backward-compat with anything still calling summary().
export interface SalesSummary {
  revenue: number;
  paidOrders: number;
  pendingReview: number;
  awaitingPayment: number;
  topProducts: { name: string; quantity: number; revenue: number }[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const num = (v: unknown) => Number(v ?? 0);

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const STATUS_LABELS: Record<string, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  PAYMENT_REVIEW: 'Payment review',
  PAID: 'Paid',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially refunded',
};

@Injectable()
export class AnalyticsService {
  private cache = new Map<RangeKey, { at: number; data: AnalyticsDashboard }>();
  private readonly ttlMs = 120_000; // 2 min — dashboards don't need to be live.

  constructor(private readonly prisma: PrismaService) {}

  static normalizeRange(input?: string): RangeKey {
    return (input && input in RANGES ? input : '30d') as RangeKey;
  }

  async dashboard(rangeInput?: string): Promise<AnalyticsDashboard> {
    const key = AnalyticsService.normalizeRange(rangeInput);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.data;

    const data = await this.compute(RANGES[key]);
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }

  // ── Computation ──────────────────────────────────────────────────────────
  private async compute(cfg: RangeConfig): Promise<AnalyticsDashboard> {
    const buckets = this.buildBuckets(cfg);
    const startKey = buckets[0].key;
    const prevStartKey = this.prevStartKey(cfg);
    const start = `${startKey} 00:00:00`;
    const prevStart = `${prevStartKey} 00:00:00`;
    const peakStart = `${this.daysAgoKey(89)} 00:00:00`;
    const bucketExpr = this.bucketExpr(cfg.bucket);

    const [
      trendRows,
      revOrdKpi,
      custKpi,
      statusRows,
      topProductRows,
      topCategoryRows,
      hourRows,
      weekdayRows,
      opsStatus,
      lowStockRow,
      recentOrders,
    ] = await Promise.all([
      // Trend: revenue + orders per bucket (realised sales).
      this.prisma.$queryRaw<{ bucket: string; revenue: string; orders: bigint }[]>(
        Prisma.sql`SELECT DATE_FORMAT(${Prisma.raw(bucketExpr)}, '%Y-%m-%d') AS bucket,
                     COALESCE(SUM(grandTotal),0) AS revenue, COUNT(*) AS orders
                   FROM \`Order\`
                   WHERE status IN ${Prisma.raw(SOLD)} AND ${Prisma.raw(SALE_TS)} >= ${start}
                   GROUP BY bucket ORDER BY bucket`,
      ),
      // Revenue + order count: current period vs previous period.
      this.prisma.$queryRaw<
        { revCur: string; ordCur: bigint; revPrev: string; ordPrev: bigint }[]
      >(
        Prisma.sql`SELECT
                     COALESCE(SUM(CASE WHEN ${Prisma.raw(SALE_TS)} >= ${start} THEN grandTotal END),0) AS revCur,
                     COUNT(CASE WHEN ${Prisma.raw(SALE_TS)} >= ${start} THEN 1 END) AS ordCur,
                     COALESCE(SUM(CASE WHEN ${Prisma.raw(SALE_TS)} >= ${prevStart} AND ${Prisma.raw(SALE_TS)} < ${start} THEN grandTotal END),0) AS revPrev,
                     COUNT(CASE WHEN ${Prisma.raw(SALE_TS)} >= ${prevStart} AND ${Prisma.raw(SALE_TS)} < ${start} THEN 1 END) AS ordPrev
                   FROM \`Order\`
                   WHERE status IN ${Prisma.raw(SOLD)} AND ${Prisma.raw(SALE_TS)} >= ${prevStart}`,
      ),
      // New customers: current vs previous period.
      this.prisma.$queryRaw<{ cur: bigint; prev: bigint }[]>(
        Prisma.sql`SELECT
                     COUNT(CASE WHEN ${Prisma.raw(`CONVERT_TZ(createdAt,'+00:00','${TZ}')`)} >= ${start} THEN 1 END) AS cur,
                     COUNT(CASE WHEN ${Prisma.raw(`CONVERT_TZ(createdAt,'+00:00','${TZ}')`)} >= ${prevStart} AND ${Prisma.raw(`CONVERT_TZ(createdAt,'+00:00','${TZ}')`)} < ${start} THEN 1 END) AS prev
                   FROM \`Customer\`
                   WHERE ${Prisma.raw(`CONVERT_TZ(createdAt,'+00:00','${TZ}')`)} >= ${prevStart}`,
      ),
      // Order status breakdown (all orders placed in period).
      this.prisma.$queryRaw<{ status: string; c: bigint }[]>(
        Prisma.sql`SELECT status, COUNT(*) AS c FROM \`Order\`
                   WHERE ${Prisma.raw(PLACED_TS)} >= ${start}
                   GROUP BY status ORDER BY c DESC`,
      ),
      // Top products by revenue (realised sales in period).
      this.prisma.$queryRaw<{ name: string; qty: bigint; revenue: string }[]>(
        Prisma.sql`SELECT oi.productName AS name, SUM(oi.quantity) AS qty, SUM(oi.lineTotal) AS revenue
                   FROM OrderItem oi JOIN \`Order\` o ON o.id = oi.orderId
                   WHERE o.status IN ${Prisma.raw(SOLD)} AND ${Prisma.raw(SALE_TS.replace(/paidAt|placedAt/g, (m) => 'o.' + m))} >= ${start}
                   GROUP BY oi.productName ORDER BY revenue DESC LIMIT 8`,
      ),
      // Top categories by revenue (joins through the product's categories).
      this.prisma.$queryRaw<{ name: string; revenue: string; qty: bigint }[]>(
        Prisma.sql`SELECT c.name AS name, SUM(oi.lineTotal) AS revenue, SUM(oi.quantity) AS qty
                   FROM OrderItem oi
                   JOIN \`Order\` o ON o.id = oi.orderId
                   JOIN ProductVariant pv ON pv.id = oi.variantId
                   JOIN CategoryProduct cp ON cp.productId = pv.productId
                   JOIN Category c ON c.id = cp.categoryId
                   WHERE o.status IN ${Prisma.raw(SOLD)} AND ${Prisma.raw(SALE_TS.replace(/paidAt|placedAt/g, (m) => 'o.' + m))} >= ${start}
                   GROUP BY c.id, c.name ORDER BY revenue DESC LIMIT 6`,
      ),
      // Peak hour of day (trailing 90 days of sales, by when the order was placed).
      this.prisma.$queryRaw<{ h: number; c: bigint }[]>(
        Prisma.sql`SELECT HOUR(${Prisma.raw(PLACED_TS)}) AS h, COUNT(*) AS c
                   FROM \`Order\` WHERE status IN ${Prisma.raw(SOLD)} AND ${Prisma.raw(PLACED_TS)} >= ${peakStart}
                   GROUP BY h`,
      ),
      // Peak weekday (trailing 90 days).
      this.prisma.$queryRaw<{ d: number; c: bigint; revenue: string }[]>(
        Prisma.sql`SELECT DAYOFWEEK(${Prisma.raw(PLACED_TS)}) AS d, COUNT(*) AS c, COALESCE(SUM(grandTotal),0) AS revenue
                   FROM \`Order\` WHERE status IN ${Prisma.raw(SOLD)} AND ${Prisma.raw(PLACED_TS)} >= ${peakStart}
                   GROUP BY d`,
      ),
      // Operational snapshot — current open work (all-time, not period-bound).
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      // Low-stock variants (stock at or below its own threshold).
      this.prisma.$queryRaw<{ c: bigint }[]>(
        Prisma.sql`SELECT COUNT(*) AS c FROM ProductVariant WHERE isActive = 1 AND stock <= lowStockThreshold`,
      ),
      // Recent orders.
      this.prisma.order.findMany({
        orderBy: { placedAt: 'desc' },
        take: 8,
        select: {
          orderNumber: true,
          placedAt: true,
          email: true,
          grandTotal: true,
          status: true,
          currency: true,
        },
      }),
    ]);

    // ── Shape results ──────────────────────────────────────────────────────
    const trendMap = new Map(trendRows.map((r) => [r.bucket, r]));
    const trend: TrendPoint[] = buckets.map((b) => {
      const row = trendMap.get(b.key);
      return {
        key: b.key,
        label: b.label,
        revenue: row ? num(row.revenue) : 0,
        orders: row ? num(row.orders) : 0,
      };
    });

    const k = revOrdKpi[0] ?? { revCur: '0', ordCur: 0n, revPrev: '0', ordPrev: 0n };
    const revCur = num(k.revCur), ordCur = num(k.ordCur);
    const revPrev = num(k.revPrev), ordPrev = num(k.ordPrev);
    const aovCur = ordCur ? revCur / ordCur : 0;
    const aovPrev = ordPrev ? revPrev / ordPrev : 0;
    const cust = custKpi[0] ?? { cur: 0n, prev: 0n };

    const periodOrdersTotal = statusRows.reduce((s, r) => s + num(r.c), 0);
    const periodSold = statusRows
      .filter((r) => ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(r.status))
      .reduce((s, r) => s + num(r.c), 0);

    const hourMap = new Map(hourRows.map((r) => [Number(r.h), num(r.c)]));
    const peakHours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      orders: hourMap.get(hour) ?? 0,
    }));
    const peakHour = peakHours.reduce<{ hour: number; orders: number } | null>(
      (best, h) => (h.orders > 0 && (!best || h.orders > best.orders) ? h : best),
      null,
    );

    const wdMap = new Map(weekdayRows.map((r) => [Number(r.d), r]));
    const weekdays = Array.from({ length: 7 }, (_, i) => {
      const dow = i + 1; // 1=Sun..7=Sat (MySQL DAYOFWEEK)
      const row = wdMap.get(dow);
      return {
        day: dow,
        label: WEEKDAY_LABELS[i],
        orders: row ? num(row.c) : 0,
        revenue: row ? num(row.revenue) : 0,
      };
    });
    const peakDay = weekdays.reduce<{ label: string; orders: number } | null>(
      (best, d) => (d.orders > 0 && (!best || d.orders > best.orders) ? d : best),
      null,
    );

    const opsMap = new Map(opsStatus.map((r) => [r.status, r._count._all]));

    return {
      range: { key: cfg.key, label: cfg.label, bucket: cfg.bucket },
      ranges: Object.values(RANGES).map((r) => ({ key: r.key, label: r.label })),
      kpis: {
        revenue: this.kpi(revCur, revPrev),
        orders: this.kpi(ordCur, ordPrev),
        aov: this.kpi(aovCur, aovPrev),
        customers: this.kpi(num(cust.cur), num(cust.prev)),
      },
      paidRate: periodOrdersTotal ? (periodSold / periodOrdersTotal) * 100 : 0,
      trend,
      peakHours,
      peakHour,
      weekdays,
      peakDay: peakDay ? { label: peakDay.label, orders: peakDay.orders } : null,
      statusBreakdown: statusRows.map((r) => ({
        status: r.status,
        label: STATUS_LABELS[r.status] ?? r.status,
        count: num(r.c),
      })),
      topProducts: topProductRows.map((t) => ({
        name: t.name,
        quantity: num(t.qty),
        revenue: num(t.revenue),
      })),
      topCategories: topCategoryRows.map((t) => ({
        name: t.name,
        revenue: num(t.revenue),
        quantity: num(t.qty),
      })),
      ops: {
        awaitingPayment: opsMap.get('AWAITING_PAYMENT') ?? 0,
        paymentReview: opsMap.get('PAYMENT_REVIEW') ?? 0,
        processing: opsMap.get('PROCESSING') ?? 0,
        shipped: opsMap.get('SHIPPED') ?? 0,
        lowStock: num(lowStockRow[0]?.c),
      },
      recentOrders: recentOrders.map((o) => ({
        orderNumber: o.orderNumber,
        placedAt: o.placedAt,
        email: o.email,
        grandTotal: num(o.grandTotal),
        status: o.status,
        currency: o.currency,
      })),
      generatedAt: new Date(),
    };
  }

  private kpi(value: number, prev: number): Kpi {
    return {
      value,
      prev,
      deltaPct: prev > 0 ? ((value - prev) / prev) * 100 : null,
    };
  }

  // ── Bucket helpers (Bangladesh local dates) ───────────────────────────────

  /** A Date whose UTC fields read as Bangladesh local time. */
  private bdNow(): Date {
    return new Date(Date.now() + 6 * 3600 * 1000);
  }

  /** BD-local date key (YYYY-MM-DD) for "today minus n days". */
  private daysAgoKey(n: number): string {
    const b = this.bdNow();
    const d = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - n * 86400000);
    return d.toISOString().slice(0, 10);
  }

  private bucketExpr(bucket: 'day' | 'week' | 'month'): string {
    const base = SALE_TS;
    if (bucket === 'day') return `DATE(${base})`;
    if (bucket === 'week')
      return `DATE_SUB(DATE(${base}), INTERVAL WEEKDAY(${base}) DAY)`;
    return `DATE(DATE_FORMAT(${base}, '%Y-%m-01'))`;
  }

  /** Ordered list of bucket {key,label} from oldest to newest for the range. */
  private buildBuckets(cfg: RangeConfig): { key: string; label: string }[] {
    const b = this.bdNow();
    const out: { key: string; label: string }[] = [];

    if (cfg.bucket === 'day') {
      const today = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
      for (let i = cfg.units - 1; i >= 0; i--) {
        const d = new Date(today - i * 86400000);
        out.push({
          key: d.toISOString().slice(0, 10),
          label: `${d.getUTCDate()} ${MONTH_LABELS[d.getUTCMonth()]}`,
        });
      }
    } else if (cfg.bucket === 'week') {
      const dow = (b.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
      const monday = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - dow * 86400000;
      for (let i = cfg.units - 1; i >= 0; i--) {
        const d = new Date(monday - i * 7 * 86400000);
        out.push({
          key: d.toISOString().slice(0, 10),
          label: `${d.getUTCDate()} ${MONTH_LABELS[d.getUTCMonth()]}`,
        });
      }
    } else {
      let y = b.getUTCFullYear();
      let m = b.getUTCMonth();
      const keys: { key: string; label: string }[] = [];
      for (let i = 0; i < cfg.units; i++) {
        keys.push({
          key: `${y}-${pad(m + 1)}-01`,
          label: `${MONTH_LABELS[m]}${m === 0 || i === cfg.units - 1 ? " '" + String(y).slice(2) : ''}`,
        });
        m--;
        if (m < 0) { m = 11; y--; }
      }
      out.push(...keys.reverse());
    }
    return out;
  }

  /** BD-local start key of the period immediately before the current one. */
  private prevStartKey(cfg: RangeConfig): string {
    const b = this.bdNow();
    if (cfg.bucket === 'day') return this.daysAgoKey(cfg.units * 2 - 1);
    if (cfg.bucket === 'week') {
      const dow = (b.getUTCDay() + 6) % 7;
      const monday = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - dow * 86400000;
      const d = new Date(monday - (cfg.units * 2 - 1) * 7 * 86400000);
      return d.toISOString().slice(0, 10);
    }
    let y = b.getUTCFullYear();
    let m = b.getUTCMonth() - (cfg.units * 2 - 1);
    while (m < 0) { m += 12; y--; }
    return `${y}-${pad(m + 1)}-01`;
  }

  /** Sales aggregates (legacy summary — retained for compatibility). */
  async summary(): Promise<SalesSummary> {
    const [totals] = await this.prisma.$queryRawUnsafe<
      { revenue: string | null; orders: bigint }[]
    >(
      `SELECT COALESCE(SUM(grandTotal),0) AS revenue, COUNT(*) AS orders
       FROM \`Order\` WHERE status IN ${SOLD}`,
    );

    const topProducts = await this.prisma.$queryRawUnsafe<
      { name: string; quantity: bigint; revenue: string }[]
    >(
      `SELECT oi.productName AS name, SUM(oi.quantity) AS quantity, SUM(oi.lineTotal) AS revenue
       FROM OrderItem oi JOIN \`Order\` o ON o.id = oi.orderId
       WHERE o.status IN ${SOLD}
       GROUP BY oi.productName ORDER BY quantity DESC LIMIT 10`,
    );

    const [pendingReview, awaitingPayment] = await Promise.all([
      this.prisma.order.count({ where: { status: 'PAYMENT_REVIEW' } }),
      this.prisma.order.count({ where: { status: 'AWAITING_PAYMENT' } }),
    ]);

    return {
      revenue: num(totals?.revenue),
      paidOrders: num(totals?.orders),
      pendingReview,
      awaitingPayment,
      topProducts: topProducts.map((t) => ({
        name: t.name,
        quantity: num(t.quantity),
        revenue: num(t.revenue),
      })),
    };
  }
}
