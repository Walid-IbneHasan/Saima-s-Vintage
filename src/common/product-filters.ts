export type ProductSort = 'newest' | 'price_asc' | 'price_desc' | 'name';

const SORTS: ProductSort[] = ['newest', 'price_asc', 'price_desc', 'name'];

export interface ProductFilters {
  sort: ProductSort;
  priceMin?: number;
  priceMax?: number;
  inStock: boolean;
  onSale: boolean;
}

function toNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function truthy(v: unknown): boolean {
  return v === '1' || v === 'on' || v === 'true' || v === true;
}

/** Parse storefront listing filters from a query object (untrusted input). */
export function parseProductFilters(q: Record<string, unknown>): ProductFilters {
  const sort = SORTS.includes(q.sort as ProductSort)
    ? (q.sort as ProductSort)
    : 'newest';
  return {
    sort,
    priceMin: toNum(q.priceMin),
    priceMax: toNum(q.priceMax),
    inStock: truthy(q.inStock),
    onSale: truthy(q.onSale),
  };
}

/** Build the non-default filter params as a query string ending in `&` (or ''). */
export function filterQueryString(f: ProductFilters): string {
  const parts: string[] = [];
  if (f.sort && f.sort !== 'newest') parts.push(`sort=${encodeURIComponent(f.sort)}`);
  if (f.priceMin !== undefined) parts.push(`priceMin=${f.priceMin}`);
  if (f.priceMax !== undefined) parts.push(`priceMax=${f.priceMax}`);
  if (f.inStock) parts.push('inStock=1');
  if (f.onSale) parts.push('onSale=1');
  return parts.length ? `${parts.join('&')}&` : '';
}
