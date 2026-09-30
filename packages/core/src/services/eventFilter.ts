/**
 * Event subscription matching, pure. `EventService.emitEvent` uses it to pick
 * the automations and workflows an event starts; the decision page uses it to
 * say, before a person answers, what the answer will start
 * (`services/inbox/askDecided`).
 */

/**
 * A trigger fires only if every key in `filter` matches the payload: equal,
 * or — for a key ending in `Prefix` — the field it names starts with the
 * value (`branchPrefix: factory/` matches `branch: factory/send-t146-…`),
 * or — for a key ending in `Any` with a list — the field it names, a list
 * (an array, or comma-joined as `object.updated`'s `fields` is), shares at
 * least one item with it (`fieldsAny: [acceptance, outcome]` matches
 * `fields: "acceptance,visuals"`). That is how an automation says which
 * fields it reads, so a write of anything else never starts it (#269: a
 * drawing mark started `factory-contract-changed` five times in four minutes).
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
    if (k.endsWith('Any') && Array.isArray(v)) {
      const items = listOf(payload[k.slice(0, -'Any'.length)]);
      return v.some(x => items.includes(String(x)));
    }
    return false;
  });
}

/**
 * A payload field read as a list: an array's items, or a comma-joined string's parts.
 * @param v - The field.
 */
function listOf(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map(String);
  }
  return typeof v === 'string' ? v.split(',').map(x => x.trim()).filter(Boolean) : [];
}

/**
 * Whether an automation's `when.event` — one type or several — names this one.
 * @param subscribed - `whenConfig.event` as stored.
 * @param type - The event being emitted.
 */
export function subscribesTo(subscribed: string | string[] | undefined, type: string): boolean {
  return Array.isArray(subscribed) ? subscribed.includes(type) : subscribed === type;
}
