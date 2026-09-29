/**
 * An option's id from its label — the one rule the ask service (which stores
 * options) and a ruling card (which answers with one) both use, so the id a
 * card sends is always the id the ask holds.
 * @param label - The option's label.
 */
export function slugifyOption(label: string): string {
  const slug = label.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'option';
}
