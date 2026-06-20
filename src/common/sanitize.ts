import sanitizeHtml from 'sanitize-html';

/**
 * Sanitize admin-authored rich text before storage. Templates render this with
 * `| safe`, so this is the single trust boundary for product/page HTML.
 */
export function sanitizeRichText(dirty: string | null | undefined): string {
  if (!dirty) return '';
  return sanitizeHtml(dirty, {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li',
      'a', 'h2', 'h3', 'h4', 'blockquote', 'span', 'hr',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        rel: 'noopener noreferrer nofollow',
      }),
    },
  });
}

/** Strip all HTML — for short descriptions / meta fields. */
export function stripHtml(dirty: string | null | undefined): string {
  if (!dirty) return '';
  return sanitizeHtml(dirty, { allowedTags: [], allowedAttributes: {} }).trim();
}
