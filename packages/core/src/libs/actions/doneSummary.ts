/**
 * WHAT A RUN THAT RAN DID, IN ONE CLAUSE.
 *
 * Chris, 2026-09-28, on request #124's page: the card "Write the narrowed
 * scope onto 124 · Done for you · Undo" did not say it had already happened —
 * the title is the agent's imperative, and "Done for you" named no change.
 * An executed card reads "Done for you — changed request #124: outcome,
 * mainRisk", from the run's own result, so the words are the receipt.
 *
 * Pure, so the card, the review row and a test read the same sentence.
 * Null when the run says nothing a person could check; the card then keeps
 * its plain state.
 */

type Meta = Record<string, unknown>;

function positiveInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function words(slug: string): string {
  return slug.replace(/[_-]+/g, ' ').trim();
}

function fieldList(keys: string[]): string {
  const shown = keys.slice(0, 4);
  return `${shown.join(', ')}${keys.length > shown.length ? ` +${keys.length - shown.length} more` : ''}`;
}

/**
 * The option a ruling was answered with, and whether the trust bar chose it
 * (`ask.file` done for you) or a person did. Null for any other run.
 * @param run - The run.
 * @param run.actionId - Its action.
 * @param run.result - What it returned.
 */
export function chosenOption(run: { actionId: string; result: Meta | null }): { label: string; byTrustBar: boolean } | null {
  if (run.actionId !== 'ask.file' || !run.result) {
    return null;
  }
  const id = typeof run.result.answered === 'string' ? run.result.answered : null;
  if (!id) {
    return null;
  }
  const label = typeof run.result.answeredLabel === 'string' && run.result.answeredLabel ? run.result.answeredLabel : id;
  return { label, byTrustBar: run.result.answeredBy === 'trust-ladder' };
}

/**
 * The clause for a done run.
 * @param run - The run.
 * @param run.actionId - Its action.
 * @param run.input - What it was asked to do.
 * @param run.result - What it returned.
 * @param made - The record it made or changed, when the caller already read it (`refOf`).
 * @param made.type - That record's type.
 * @param made.id - Its id.
 */
export function doneSummary(run: { actionId: string; input: Meta | null; result: Meta | null }, made?: { type: string; id: number } | null): string | null {
  const input = run.input ?? {};
  const result = run.result ?? {};
  if (run.actionId === 'objects.update_meta') {
    const set = (result.set ?? input.set) as Meta | undefined;
    const keys = set && typeof set === 'object' && !Array.isArray(set) ? Object.keys(set) : [];
    const type = typeof input.objectType === 'string' ? input.objectType : made?.type;
    const id = positiveInt(input.id) ?? made?.id ?? null;
    if (!type || id === null) {
      return null;
    }
    return keys.length > 0 ? `changed ${words(type)} #${id}: ${fieldList(keys)}` : `changed ${words(type)} #${id}`;
  }
  const chosen = chosenOption(run);
  if (chosen) {
    return chosen.byTrustBar ? `chose "${chosen.label}" for you` : `chose "${chosen.label}"`;
  }
  if (run.actionId === 'objects.rename') {
    const id = positiveInt(input.id) ?? made?.id ?? null;
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    return id !== null && title ? `renamed #${id} to "${title.slice(0, 80)}"` : null;
  }
  if (run.actionId === 'factory.dispatch_task') {
    const requestId = positiveInt(result.requestId) ?? positiveInt(input.requestId);
    const of = requestId !== null ? ` of request #${requestId}` : '';
    // A dispatch whose plan no longer fits sends the request back to planning
    // and starts nothing (`planning: true`); saying "started the build" there
    // was a claim the run did not make (2026-09-29, action run 5201).
    if (result.planning === true) {
      return requestId !== null ? `sent request #${requestId} back to planning` : 'sent it back to planning';
    }
    const workerRunId = positiveInt(result.workerRunId);
    return `started the build${of}${workerRunId !== null ? ` — run #${workerRunId}` : ''}`;
  }
  if (made && made.type !== run.actionId) {
    return run.actionId === 'objects.propose_candidate' ? `filed ${words(made.type)} #${made.id}` : `made ${words(made.type)} #${made.id}`;
  }
  return null;
}
