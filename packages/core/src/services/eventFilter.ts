/**
 * Event subscription matching, pure. `EventService.emitEvent` uses it to pick
 * the automations and workflows an event starts; the decision page uses it to
 * say, before a person answers, what the answer will start
 * (`services/inbox/askDecided`).
 */

/**
 * A trigger fires only if every key in `filter` matches the payload: equal,
 * or — for a key ending in `Prefix` — the field it names starts with the
 * value (`branchPrefix: factory/` matches `branch: factory/send-t146-…`).
 *
 * The plugin's QA automations have filtered on `branchPrefix` since they were
 * written, and with `===` only they compared against a `branchPrefix` field no
 * event carries, so the QA-on-PR and learn-from-merged automations never fired
 * once (red team, 2026-09-26).
 * @param payload
 * @param filter
 */
export function matchesFilter(payload: Record<string, unknown>, filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') {
    return true;
  }
  return Object.entries(filter as Record<string, unknown>).every(([k, v]) => {
    if (payload[k] === v) {
      return true;
    }
    if (k.endsWith('Prefix') && typeof v === 'string') {
      const field = payload[k.slice(0, -'Prefix'.length)];
      return typeof field === 'string' && field.startsWith(v);
    }
    return false;
  });
}

/**
 * Whether an automation's `when.event` — one type or several — names this one.
 * @param subscribed - `whenConfig.event` as stored.
 * @param type - The event being emitted.
 */
export function subscribesTo(subscribed: string | string[] | undefined, type: string): boolean {
  return Array.isArray(subscribed) ? subscribed.includes(type) : subscribed === type;
}
