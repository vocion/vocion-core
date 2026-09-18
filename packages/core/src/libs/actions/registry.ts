/**
 * Registry of connector-write actions — the mutation counterpart to
 * `libs/sources/registry`. ActionService looks actions up by id; the future
 * dashboard/MCP surfaces list them for a "what can this teammate do" view.
 */

import type { Action } from './types';
import { discoveryReviewProposalAction } from './discovery-review';
import { gmailSendAction } from './gmail-send';
import { hubspotUpdateAction } from './hubspot-update';
import { objectProposeCandidateAction } from './objects-propose-candidate';
import { personalizationEnrollAction } from './personalization-enroll';
import { pluginEnableAction } from './plugin-enable';
import { qcActions } from './qc';
import { wikiWritePageAction } from './wiki-write-page';

const registry = new Map<string, Action>();

export function registerAction(action: Action): void {
  registry.set(action.id, action);
}

export function getAction(id: string): Action | undefined {
  return registry.get(id);
}

export function listActions(): Action[] {
  return Array.from(registry.values());
}

// Built-ins.
registerAction(gmailSendAction);
registerAction(hubspotUpdateAction);
registerAction(discoveryReviewProposalAction);
registerAction(personalizationEnrollAction);
registerAction(objectProposeCandidateAction);
// Turn a workspace plugin on/off from chat — reversible, internal, done-for-you above the bar.
registerAction(pluginEnableAction);
// A wiki page write — reversible (restore the previous version), done-for-you above the wiki plugin's bar.
registerAction(wikiWritePageAction);
// Kit / assembly verification decisions + the training-set loop (granted per workspace via trust + agents).
for (const a of qcActions) {
  registerAction(a as Action);
}
