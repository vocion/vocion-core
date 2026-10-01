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
