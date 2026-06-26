export interface VariantLabelParts {
  name: string;
  size?: string | null;
  color?: string | null;
}

/**
 * Human-readable label for a variant — combines its name (unless it's the
 * placeholder "Default"), size and colour, e.g. "Medium · M · Blue".
 * Returns '' for a plain default variant with no size/colour, so callers can
 * hide it for simple products.
 */
export function variantLabel(v: VariantLabelParts): string {
  const parts: string[] = [];
  if (v.name && v.name.trim().toLowerCase() !== 'default') parts.push(v.name.trim());
  if (v.size) parts.push(v.size);
  if (v.color) parts.push(v.color);
  return parts.join(' · ');
}
