/**
 * Registry of connector-write actions — the mutation counterpart to
 * `libs/sources/registry`. ActionService looks actions up by id; the future
 * dashboard/MCP surfaces list them for a "what can this teammate do" view.
 */

import type { Action } from './types';
import { agentRevisePromptAction } from './agent-revise-prompt';
import { askFileAction } from './ask-file';
import { askWithdrawAction } from './ask-withdraw';
import { discoveryReviewProposalAction } from './discovery-review';
import { factoryActions } from './factory';
import { gmailSendAction } from './gmail-send';
import { hubspotUpdateAction } from './hubspot-update';
import { learningAdoptRuleAction } from './learning-adopt-rule';
import { missionUpdateNotesAction } from './mission-update-notes';
import { objectProposeCandidateAction } from './objects-propose-candidate';
import { objectsRenameAction } from './objects-rename';
import { objectsUpdateMetaAction } from './objects-update-meta';
import { personalizationEnrollAction } from './personalization-enroll';
import { playbookWriteAction } from './playbook-write';
import { pluginEnableAction } from './plugin-enable';
import { qcActions } from './qc';
import { teamHireAgentAction } from './team-hire-agent';
import { wikiWritePageAction } from './wiki-write-page';
import { workspaceWriteOperatingIntentAction } from './workspace-operating-intent';
import { workspaceWriteMissionAction, workspaceWritePlaybookAction } from './workspace-source';

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
// An agent writes declared fields on a record that exists — reversible (the
// previous values ride the run), low-risk, done-for-you above the bar. The
// record's write history is these runs.
registerAction(objectsUpdateMetaAction);
registerAction(objectsRenameAction);
// An agent puts a question in front of a person, and takes it back when the
// thing it asked about went away. Both reversible and internal: the ask is
// the outcome, nothing executes on the answer.
registerAction(askFileAction);
registerAction(askWithdrawAction);
// Turn a workspace plugin on/off from chat — reversible, internal, done-for-you above the bar.
registerAction(pluginEnableAction);
// An agent adds a teammate from the catalog, with the daily allowance it is
// hired under — reversible (the agent, its budget and the team the hire
// created all go back), internal, and held at approval until a workspace
// promotes it (`medium`, so autonomous is never on offer).
registerAction(teamHireAgentAction);
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
// A mission's YAML or a playbook's SKILL.md, written by an agent — reversible, internal, held at
// Execute with approval by default (`DEFAULT_RISK_TIER`) until a workspace promotes it.
registerAction(workspaceWriteMissionAction);
registerAction(workspaceWritePlaybookAction);
registerAction(workspaceWriteOperatingIntentAction);
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
