/**
 * Registry of connector-write actions — the mutation counterpart to
 * `libs/sources/registry`. ActionService looks actions up by id; the future
 * dashboard/MCP surfaces list them for a "what can this teammate do" view.
 */

import type { Action } from './types';
import { agentRevisePromptAction } from './agent-revise-prompt';
import { discoveryReviewProposalAction } from './discovery-review';
import { factoryActions } from './factory';
import { gmailSendAction } from './gmail-send';
import { hubspotUpdateAction } from './hubspot-update';
import { learningAdoptRuleAction } from './learning-adopt-rule';
import { missionUpdateNotesAction } from './mission-update-notes';
import { objectProposeCandidateAction } from './objects-propose-candidate';
import { personalizationEnrollAction } from './personalization-enroll';
import { playbookWriteAction } from './playbook-write';
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
// A correction a person made, adopted as a standing rule — reversible (Undo
// removes it from the step), done-for-you above the bar in the plugin's trust.yaml.
registerAction(learningAdoptRuleAction);
// The rest of the self-improvement class (`libs/actions/selfUpdate.ts`) — the
// system changing itself rather than the world. Each one is reversible, each
// shows where it happened, and each is undone in one click.
registerAction(missionUpdateNotesAction);
registerAction(playbookWriteAction);
registerAction(agentRevisePromptAction);
// Kit / assembly verification decisions + the training-set loop (granted per workspace via trust + agents).
for (const a of qcActions) {
  registerAction(a as Action);
}
// The software factory's hand-offs — merges, deploys, credentials,
// announcements. Performed by a person or an outside system after approval;
// core records the trail (`libs/actions/manual.ts`, `libs/actions/factory.ts`).
for (const a of factoryActions) {
  registerAction(a);
}
