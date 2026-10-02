// Usage a heartbeat carries, kept so it is reported once: taken before the post, and put back
// beside anything reported since when the post did not land (core, run 2, 2026-10-01: two
// heartbeats in flight carried the same final usage, and the run's cents read double).

/**
 * Usage that did not land, put back beside any reported since: summed, so nothing is lost or
 * counted twice.
 * @param {object|null} pending - Usage waiting now, or null.
 * @param {object|null} unsent - The usage the failed heartbeat carried, or null.
 * @returns {object|null} The usage to send next.
 */
export function withUsage(pending, unsent) {
  if (!unsent) {
    return pending;
  }
  if (!pending) {
    return unsent;
  }
  const sum = k => (pending[k] || 0) + (unsent[k] || 0);
  return { model: pending.model || unsent.model, inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadTokens: sum('cacheReadTokens'), cents: sum('cents') };
}

/**
 * A resumed Claude Code session reports `modelUsage` as its total since the session began. This
 * pass's share is that total less what the session had reported before it, field by field.
 * @param {Record<string, Record<string, number>>} now - modelUsage after this pass.
 * @param {Record<string, Record<string, number>>} before - modelUsage the session reported before it.
 * @returns {Record<string, Record<string, number>>} Per model, the numeric fields' differences.
 */
export function usageDelta(now = {}, before = {}) {
  const out = {};
  for (const [m, u] of Object.entries(now || {})) {
    const prior = (before || {})[m] || {};
    const row = {};
    for (const [k, v] of Object.entries(u || {})) {
      row[k] = typeof v === 'number' ? Math.max(0, v - (Number(prior[k]) || 0)) : v;
    }
    out[m] = row;
  }
  return out;
}
