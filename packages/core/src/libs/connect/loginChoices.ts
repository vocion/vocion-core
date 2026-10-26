/**
 * The choices a stored login offers a source's settings, so a person picks
 * the ad account the login reaches instead of typing its id (Chris,
 * 2026-10-25: users never type ids or paste keys). Read from what a
 * provider's `exchange` stored beside the token (`adAccounts`: id and name,
 * not secret); never from the token, and never by calling the vendor.
 */

/** One option for a `choicesFromLogin` field. */
export type LoginChoice = { value: string; label: string };

/**
 * The ad accounts a stored login reaches, as select options, or an empty
 * list when the bag holds none (a pasted token, an older login).
 * @param bag - The decrypted login credential.
 */
export function loginChoicesFrom(bag: Record<string, unknown> | null | undefined): LoginChoice[] {
  const accounts = Array.isArray(bag?.adAccounts) ? bag.adAccounts : [];
  const seen = new Set<string>();
  return accounts.flatMap((a) => {
    if (!a || typeof a !== 'object') {
      return [];
    }
    const { id, name } = a as { id?: unknown; name?: unknown };
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) {
      return [];
    }
    seen.add(id);
    const label = typeof name === 'string' && name.trim() ? `${name.trim()} (${id})` : id;
    return [{ value: id, label }];
  });
}
