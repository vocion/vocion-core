/**
 * `/dashboard/review` is gone as a destination — the review queue is the
 * `proposal` kind on "Review queue". Old links (mail, Slack, bookmarks, the
 * palette's muscle memory) land here and are sent on, permanently (308), with
 * the one filter the old page had (`?type=<action id>`, repeated or
 * comma-joined) carried over as the inbox's `?actionKind=`.
 *
 * Pure, so the mapping is tested without a request.
 * @param searchParams - The old page's query, as Next hands it over.
 */
export function reviewRedirectTarget(searchParams: Record<string, string | string[] | undefined> = {}): string {
  const raw = searchParams.type;
  const types = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .flatMap(v => v.split(','))
    .map(v => v.trim())
    .filter(Boolean);
  const qs = new URLSearchParams({ kind: 'proposal' });
  if (types.length > 0) {
    qs.set('actionKind', [...new Set(types)].join(','));
  }
  return `/dashboard/inbox?${qs.toString()}`;
}
