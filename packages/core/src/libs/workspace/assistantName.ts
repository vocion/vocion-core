/**
 * WHAT A PERSON'S OWN ASSISTANT IS CALLED.
 *
 * Every Personal workspace has one agent, the person's assistant
 * (`templates/personal/agents/assistant.yaml`). Until the person names it, it
 * introduces itself by its role, "your personal assistant on Metacto"; once
 * named ("Ziggy") it is that name: "Hi Chris — I'm Ziggy.", "Ask Ziggy…".
 *
 * The same mechanism as the workspace lead's given name (`leadName.ts`): the
 * name is the agent's own `name`, and the template's placeholder means "not
 * named yet". Pure and client-safe.
 */

/** The assistant's slug, as the template authors it (`personalAssistant.test.ts` holds the two together). */
export const PERSONAL_ASSISTANT_SLUG = 'assistant';

/** Names the assistant carries when nobody named it: the template's. */
const PLACEHOLDER_NAMES = new Set(['assistant', 'personal assistant', 'your assistant']);

export type AssistantName = {
  /** The name the person gave it ("Ziggy"), or null. */
  given: string | null;
  /** Its role, on this install or Org ("personal assistant on Metacto"). */
  role: string;
  /** What it is called in a sentence: "Ziggy", or "your assistant". */
  short: string;
};

/**
 * Whether an agent is a person's own assistant.
 * @param slug - The agent's slug.
 */
export function isPersonalAssistant(slug: string): boolean {
  return slug === PERSONAL_ASSISTANT_SLUG;
}

/**
 * Whether this roster is a Personal workspace's: its assistant and nobody else.
 * @param slugs - The real agents' slugs, without virtual entries.
 */
export function onlyThePersonalAssistant(slugs: readonly string[]): boolean {
  return slugs.length === 1 && slugs[0] === PERSONAL_ASSISTANT_SLUG;
}

/**
 * What the assistant is called.
 * @param input - What the name is made of.
 * @param input.agentName - The assistant's stored name.
 * @param input.orgName - The Org (or install) it works on, for the role.
 */
export function assistantName(input: { agentName: string | null | undefined; orgName: string | null | undefined }): AssistantName {
  const name = (input.agentName ?? '').trim();
  const given = name && !PLACEHOLDER_NAMES.has(name.toLowerCase()) ? name : null;
  const org = (input.orgName ?? '').trim();
  return { given, role: org ? `personal assistant on ${org}` : 'personal assistant', short: given ?? 'your assistant' };
}
