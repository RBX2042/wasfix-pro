/**
 * Request parameters that cannot crash a page.
 *
 * Two inputs used to turn into HTTP 500 on pages that should answer 404 or
 * ignore the junk: a repeated query parameter (`?q=a&q=b` makes Next hand the
 * page an array, and `.trim` is not a function) and a malformed percent
 * escape in a path segment (`/onderdelen/%ZZ`, where decodeURIComponent
 * throws a URIError).
 */

/** The first value of a query parameter, whether Next gave a string, an array or nothing. */
export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** decodeURIComponent that returns null instead of throwing; callers answer 404. */
export function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
