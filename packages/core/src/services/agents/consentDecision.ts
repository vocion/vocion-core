/**
 * THE DECISION A PERSON'S CONSENT IS READ AGAINST: the action, what it acts
 * on, and what it does — never only the agent's label for it.
 *
 * Action 5949 (2026-10-01): the person said "Defer FE-318: it duplicates
 * FE-314 … the outage itself is already fixed by the revert", and the agent
 * put up "Revert squatch-core#151" — the pull request that had fixed the
 * outage. Judged as `repo.revert_pull: Revert squatch-core#151`, a revert sat
 * beside words that talked about reverts. Judged as what it is — "Roll a
 * release back (repo.revert_pull): Roll back <owner>/<repo>/pull/151, which
 * undoes "<its title>", shipped in REL-307 (production read ok after it).
 * What it does: opens GitHub's revert … and deploys what was live before" —
 * a person who asked to defer a record plainly did not ask for it.
 *
 * Read off the action's own definition and its review card, the one place an
 * action says how it reads to a person; nothing here names an action.
 */
import { getAction } from '@/libs/actions/registry';

/**
 * The sentence `saidToDecide` judges for one proposed action.
 * @param orgId - The workspace.
 * @param actionId - The action.
 * @param input - Its payload.
 * @param label - The agent's own words for it (a card's label, a rationale).
 */
export async function consentDecision(orgId: string, actionId: string, input: Record<string, unknown>, label: string): Promise<string> {
  const action = getAction(actionId);
  if (!action) {
    return `${actionId}: ${label}`;
  }
  const parsed = action.inputSchema.safeParse(input);
  const card = action.reviewCard
    ? await action.reviewCard({ orgId }, (parsed.success ? parsed.data : input) as never).catch(() => null)
    : null;
  const facts = (card?.fields ?? [])
    .filter(f => typeof f.value === 'string' && f.value.trim() !== '')
    .slice(0, 6)
    .map(f => `${f.label}: ${String(f.value).replace(/\s+/g, ' ').slice(0, 240)}`);
  return [
    `${action.name} (${action.id}): ${card?.title ?? label}.`,
    facts.length > 0 ? `What it acts on — ${facts.join('; ')}.` : `Its payload: ${JSON.stringify(input).slice(0, 400)}.`,
    `What it does: ${action.description.slice(0, 400)}`,
    `The agent called it: ${label.slice(0, 200)}`,
  ].join('\n');
}
