/**
 * A font family as a person names it, from the name a built site gave it.
 *
 * A site built with Next.js renames its fonts: `next/font` emits
 * `__Inter_a64ecd` and `__Inter_Fallback_a64ecd`, and a newer build
 * `Inter-b937ba1167470226`. Firecrawl's brand extractor reads the rendered CSS,
 * so those names reached a client's Brand & guidelines as "heading
 * Barlow-364621179e86efae · primary Inter-b937ba1167470226" (a live
 * onboarding, 2026-10-27). The build hash and the fallback face are the
 * bundler's, not the brand's. Pure.
 */

/** A build hash on the end of a name: `-364621179e86efae`, `_a64ecd`. */
const HASH_SUFFIX = /[-_][0-9a-f]{6,}$/i;
/** next/font's own prefix: `__Inter_a64ecd`. */
const NEXT_FONT = /^__(.+?)_[0-9a-f]{5,}$/i;
/** The metric-matched stand-in a bundler adds beside the real face. */
const FALLBACK = /(?:^|[\s_-])fallback$/i;

/**
 * One family name, its build hash and bundler prefix taken off, underscores
 * read as spaces. Null when what is left is only a fallback face.
 * @param raw - One family, as the CSS named it.
 */
function oneFamily(raw: string): string | null {
  let name = raw.trim().replace(/^["']|["']$/g, '').trim();
  const next = NEXT_FONT.exec(name);
  if (next) {
    name = next[1]!;
  }
  // A short run of letters a-f could be a word (`-Faced`); a hash carries a digit or runs long.
  const isHash = (tail: string) => /\d/.test(tail) || tail.length > 8;
  while (HASH_SUFFIX.test(name) && isHash(HASH_SUFFIX.exec(name)![0])) {
    name = name.replace(HASH_SUFFIX, '');
  }
  name = name.replace(/^_+/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name || FALLBACK.test(name)) {
    return null;
  }
  return name;
}

/**
 * A font family (or a stack of them) as a person reads it: build hashes and
 * next/font prefixes taken off, fallback faces dropped, each name once.
 * Returns the input trimmed when nothing in it was a build artefact, and
 * undefined when nothing is left.
 * @param raw - The family or stack, as the site's CSS named it.
 */
export function cleanFontFamily(raw: string | undefined | null): string | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const names: string[] = [];
  const fallbacks: string[] = [];
  for (const part of raw.split(',')) {
    const name = oneFamily(part);
    if (name) {
      if (!names.some(n => n.toLowerCase() === name.toLowerCase())) {
        names.push(name);
      }
    } else {
      // Keep what a lone fallback face stands in for, in case it is all there is.
      const bare = part.trim().replace(/^["']|["']$/g, '').trim();
      const base = oneFamily(bare.replace(/[\s_-]?fallback(?=[-_][0-9a-f]{5,}$|$)/i, ''));
      if (base) {
        fallbacks.push(base);
      }
    }
  }
  const out = names.length > 0 ? names : fallbacks.slice(0, 1);
  return out.length > 0 ? out.join(', ') : undefined;
}

/**
 * Every role's family cleaned (`cleanFontFamily`); a role left with nothing is dropped.
 * @param fonts - Font families by role.
 */
export function cleanFontRoles(fonts: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!fonts) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [role, family] of Object.entries(fonts)) {
    const clean = cleanFontFamily(family);
    if (clean) {
      out[role] = clean;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
