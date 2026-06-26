import { Prisma } from '@prisma/client';

type D = Prisma.Decimal;

interface VariantPricing {
  price: D | null;
  salePrice: D | null;
}
interface ProductPricing {
  basePrice: D;
  salePrice: D | null;
}

/** Time-bound flash-deal fields on a product. */
export interface FlashFields {
  flashPrice: D | null;
  flashStartAt: Date | null;
  flashEndAt: Date | null;
}

/**
 * Whether a product's flash deal is live at `now`: a flash price is set, the end
 * time is in the future, and the start time (if any) has passed. This is the
 * single source of truth that makes deals appear and disappear with no cron.
 */
export function isFlashActive(p: Partial<FlashFields>, now: Date): boolean {
  return !!(
    p.flashPrice != null &&
    p.flashEndAt != null &&
    now < p.flashEndAt &&
    (p.flashStartAt == null || now >= p.flashStartAt)
  );
}

/**
 * Resolve the *effective* product pricing for `now`: while a flash deal is live
 * (and actually lower than base), the flash price becomes the salePrice fed to
 * the rest of the pricing pipeline. If a standing salePrice is even cheaper, the
 * customer keeps the cheaper one. Once the window closes, pricing reverts to the
 * standing salePrice (or full price).
 */
export function resolveProductPricing(
  p: ProductPricing & Partial<FlashFields>,
  now: Date,
): ProductPricing {
  if (isFlashActive(p, now) && p.flashPrice!.lessThan(p.basePrice)) {
    const standing = p.salePrice;
    const eff =
      standing != null && standing.lessThan(p.flashPrice!) ? standing : p.flashPrice!;
    return { basePrice: p.basePrice, salePrice: eff };
  }
  return { basePrice: p.basePrice, salePrice: p.salePrice ?? null };
}

/**
 * Prisma filter for "on sale right now" — a standing salePrice OR a live flash
 * deal. Expired flash deals are excluded automatically because `flashEndAt` must
 * be in the future. Used by the storefront Flash Deals / on-sale filter.
 */
export function onSaleWhere(now: Date): Prisma.ProductWhereInput {
  return {
    OR: [
      { salePrice: { not: null } },
      {
        flashPrice: { not: null },
        flashEndAt: { gt: now },
        OR: [{ flashStartAt: null }, { flashStartAt: { lte: now } }],
      },
    ],
  };
}

/** The regular (pre-discount) price for a variant — variant override or product base. */
export function variantRegular(v: VariantPricing, p: ProductPricing): D {
  return v.price ?? p.basePrice;
}

/**
 * The price actually charged for a variant. Pricing resolves at ONE level:
 * if the variant has its own price, the variant's salePrice applies; otherwise
 * the product's salePrice applies. A sale price only takes effect when it's
 * lower than the regular price.
 */
export function variantCurrent(v: VariantPricing, p: ProductPricing): D {
  if (v.price != null) {
    return v.salePrice != null && v.salePrice.lessThan(v.price)
      ? v.salePrice
      : v.price;
  }
  return p.salePrice != null && p.salePrice.lessThan(p.basePrice)
    ? p.salePrice
    : p.basePrice;
}

export interface PriceView {
  regular: number;
  current: number;
  onSale: boolean;
  discountPercent: number;
}

export function priceView(regular: D, current: D): PriceView {
  const r = regular.toNumber();
  const c = current.toNumber();
  const onSale = c < r;
  return {
    regular: r,
    current: c,
    onSale,
    discountPercent: onSale && r > 0 ? Math.round((1 - c / r) * 100) : 0,
  };
}

/** Display pricing at the product level (used on cards / PDP headline). */
export function productPriceView(p: ProductPricing): PriceView {
  const current =
    p.salePrice != null && p.salePrice.lessThan(p.basePrice)
      ? p.salePrice
      : p.basePrice;
  return priceView(p.basePrice, current);
}

/** Display pricing for a specific variant. */
export function variantPriceView(v: VariantPricing, p: ProductPricing): PriceView {
  return priceView(variantRegular(v, p), variantCurrent(v, p));
}

/** Format a BDT amount the same way the `money` view filter does (for JSON/JS). */
export function formatMoney(value: number | D | string | null, currency = 'BDT'): string {
  const n = Number(value);
  if (Number.isNaN(n)) return '';
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === 'BDT' ? `৳${formatted}` : `${currency} ${formatted}`;
}
