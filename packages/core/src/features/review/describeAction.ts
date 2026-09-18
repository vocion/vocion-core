// Type-only, so it is erased at build and no runtime cycle is created with
// the client module that both defines the type and re-exports this function.
import type { ActionRun } from './ReviewFocusView';

/**
 * "What am I approving?" — derived from an action run, with no React in sight.
 *
 * This lived in `ReviewFocusView.tsx`, which is `'use client'`, so calling it
 * from a server component threw *"Attempted to call describeAction() from the
 * server but describeAction is on the client."* It is a pure function over a
 * plain object and always was; only its address was wrong.
 *
 * The same trap took `labelFor` out of a decision sheet earlier this month.
 * A pure helper exported from a client module is a landmine for the next
 * server component that needs it, so it lives on its own now.
 */

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * Action verb + target system + object, from the presenter's card when there
 * is one and from the action id and input when there is not.
 * @param p - The action run.
 */
export function describeAction(p: ActionRun): { title: string; system: string; isEmail: boolean } {
  const input = p.input;
  if (p.card) {
    return { title: p.card.title, system: p.card.system ?? p.actionId.split('.')[0] ?? 'system', isEmail: false };
  }
  if (p.actionId === 'gmail.send') {
    const draft = input.draft === true;
    return { title: `${draft ? 'Draft email' : 'Send email'} → ${str(input.to) || 'recipient'}`, system: 'Gmail', isEmail: true };
  }
  if (p.actionId.startsWith('hubspot.')) {
    const objectType = str(input.objectType) || 'record';
    return { title: `Update HubSpot ${objectType === 'companies' ? 'company' : objectType.replace(/s$/, '')} record`, system: 'HubSpot CRM', isEmail: false };
  }
  return { title: p.actionId, system: p.actionId.split('.')[0] ?? 'system', isEmail: false };
}
