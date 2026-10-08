import type { BatchResult, RecommendationBatch } from '@/services/needsYou/batches';
import { INBOX_KIND_META } from './inboxMeta';

/**
 * The words around a batch on Needs you (`RecommendationBatches.tsx`) — pure,
 * so they are tested without a browser.
 */

/**
 * "3 approvals · 2 recommendations" — what the batch is made of.
 * @param batch - The batch.
 */
export function batchMakeup(batch: RecommendationBatch): string {
  const byKind = new Map<string, number>();
  for (const item of batch.items) {
    byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
  }
  return [...byKind.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => {
      const meta = INBOX_KIND_META[kind as keyof typeof INBOX_KIND_META];
      return `${n} ${(n === 1 ? meta?.label : meta?.plural)?.toLowerCase() ?? kind}`;
    })
    .join(' · ');
}

/**
 * What the toast says once a batch settles.
 * @param label - The recommendation.
 * @param result - Each item's outcome.
 */
export function batchReceipt(label: string, result: BatchResult): { title: string; description: string; ok: boolean } {
  const misses = result.results.filter(r => r.outcome !== 'accepted');
  const title = result.accepted > 0
    ? `${label} · ${result.accepted} ${result.accepted === 1 ? 'decision' : 'decisions'} accepted`
    : `Nothing accepted under “${label}”`;
  const description = misses.length === 0
    ? 'Each was decided as recommended; the agents learn from it.'
    : misses.slice(0, 3).map(m => `${m.outcome === 'failed' ? 'Failed' : 'Skipped'}: ${m.title} — ${m.reason ?? 'no reason given'}`).join(' · ')
      + (misses.length > 3 ? ` · and ${misses.length - 3} more` : '');
  return { title, description, ok: result.failed === 0 && result.accepted > 0 };
}
