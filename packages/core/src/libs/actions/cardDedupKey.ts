/**
 * The idempotency key a chat card proposes under: the same card — same
 * action, same label, same payload — is one run however many times it mounts.
 * Stable across the streamed and the stored copy of a turn, which is the
 * remount that filed every card twice (walk 20, 2026-09-25).
 *
 * FNV-1a over the canonical JSON: short, dependency-free, and only has to be
 * collision-resistant among one org's cards.
 * @param card - The card's action id, label and input.
 * @param card.actionId - The registered action.
 * @param card.label - The card's label.
 * @param card.input - The card's payload.
 */
export function cardDedupKey(card: { actionId: string; label: string; input: Record<string, unknown> }): string {
  const canonical = JSON.stringify([card.actionId, card.label.trim(), sortKeys(card.input)]);
  let hash = 0x811C9DC5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `card:${card.actionId}:${hash.toString(36)}`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map(k => [k, sortKeys((value as Record<string, unknown>)[k])]));
  }
  return value;
}
