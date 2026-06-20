export interface PageParams {
  page: number;
  limit: number;
  skip: number;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/** Clamp user-supplied paging input to safe bounds (prevents loading everything). */
export function parsePage(
  rawPage?: unknown,
  rawLimit?: unknown,
  defaultLimit = 24,
  maxLimit = 60,
): PageParams {
  const page = Math.max(1, toInt(rawPage, 1));
  const limit = Math.min(maxLimit, Math.max(1, toInt(rawLimit, defaultLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

export function buildPageMeta(
  page: number,
  limit: number,
  total: number,
): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

function toInt(value: unknown, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}
