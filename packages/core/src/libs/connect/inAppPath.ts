/**
 * Is this string a path inside the app? The one check behind every link an
 * agent or a query string can hand us: card links, field links and the
 * connect flow's return path. It stays free of imports so the browser and the
 * server can both use it.
 *
 * Rejected: anything not starting with `/`, `//host`, any backslash (a
 * browser reads `/\host` as `//host`), and any control character (it can hide
 * the real target from a person reading the link).
 * @param raw - A candidate link.
 * @returns True when it is safe to treat as a path in this product.
 */
export function isInAppPath(raw: string): boolean {
  if (!raw.startsWith('/') || raw.startsWith('//')) {
    return false;
  }
  return !raw.includes('\\') && !/\p{Cc}/u.test(raw);
}
