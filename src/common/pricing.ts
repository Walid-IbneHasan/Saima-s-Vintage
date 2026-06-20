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
