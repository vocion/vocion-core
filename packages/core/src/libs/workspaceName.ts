/**
 * A WORKSPACE NEVER WEARS A RAW SLUG OR ID AS ITS NAME (founder, 2026-10-09:
 * the picker listed "Project proj-<id>…" beside the real workspace).
 *
 * Those rows came from migration 0022, which named every backfilled project
 * `'Project ' || org_id`, and once `org_id` already held real project ids it
 * minted a second project per workspace named after the first one's id. The
 * name is stored, so every surface drew it. This is the one reading of a
 * stored name for display: a human name passes through untouched; a name that
 * is only an address (empty, the slug, the id, or the 0022 shape) is turned
 * back into words from that address, and marked as a placeholder so a list can
 * rank it below the real ones and say what it is.
 */

/** What a person reads, and whether the stored name was only an address. */
export type WorkspaceName = { name: string; placeholder: boolean };

const LEGACY_BACKFILL = /^Project ([a-z0-9][\w-]*)$/;
// A run of hex long enough to be an id, never a word.
const ID_RUN = /^[0-9a-f]{8,}$/i;

/**
 * Words from an address: `proj-larkfield-factory-9f3e1d07b2…` → "Larkfield
 * Factory". Prefixes the backfill and the id scheme add are dropped, and so is
 * every id-like segment. Null when nothing human is left.
 * @param address - A slug or an id.
 */
export function wordsFromAddress(address: string): string | null {
  const parts = address
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .filter(part => !ID_RUN.test(part) && !/^\d+$/.test(part));
  while (parts[0] === 'proj' || parts[0] === 'org' || parts[0] === 'project') {
    parts.shift();
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

/**
 * The name to show for a workspace.
 * @param p - The workspace as stored.
 * @param p.id - `project.id`.
 * @param p.slug - Its address.
 * @param p.name - Its stored name.
 * @param fallback - What to call it when nothing human can be recovered.
 */
export function workspaceDisplayName(p: { id: string; slug: string; name: string | null | undefined }, fallback = 'Untitled workspace'): WorkspaceName {
  const stored = (p.name ?? '').trim();
  const legacy = LEGACY_BACKFILL.exec(stored);
  const isAddress = stored === '' || stored === p.slug || stored === p.id || legacy !== null;
  if (!isAddress) {
    return { name: stored, placeholder: false };
  }
  const words = wordsFromAddress(legacy?.[1] ?? stored) ?? wordsFromAddress(p.slug) ?? wordsFromAddress(p.id);
  // A backfill copy shares its words with the real workspace beside it, so it
  // says what it is rather than reading as a second "Noco".
  return { name: words ? (legacy ? `${words} (placeholder)` : words) : fallback, placeholder: true };
}
