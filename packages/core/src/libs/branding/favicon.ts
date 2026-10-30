/** Optional install-specific colour for the official Vocion favicon rails. */
export function faviconColor(): string | null {
  const value = process.env.NEXT_PUBLIC_BRAND_FAVICON_COLOR?.trim();
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}
