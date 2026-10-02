/**
 * Registry of connector-write actions — the mutation counterpart to
 * `libs/sources/registry`. ActionService looks actions up by id; the future
 * dashboard/MCP surfaces list them for a "what can this teammate do" view.
 */

import type { Action } from './types';
import { agentRevisePromptAction } from './agent-revise-prompt';
import { askFileAction } from './ask-file';
import { askWithdrawAction } from './ask-withdraw';
import { chatAddReactionAction } from './chat-add-reaction';
import { chatReplyInThreadAction } from './chat-reply-in-thread';
import { discoveryReviewProposalAction } from './discovery-review';
import { factoryActions } from './factory';
import { factoryApprovePlanAction } from './factory-approve-plan';
import { factoryCheckLiveAgainAction } from './factory-check-live';
import { factoryDispatchAction } from './factory-dispatch';
import { factoryReadAttemptAction, factoryReadReleaseLiveAction, factoryStopRequestAction } from './factory-flow-steps';
import { githubDispatchWorkflowAction } from './github-dispatch';
import { githubOpenPullAction } from './github-pull';
import { githubRerunFailedJobsAction } from './github-rerun';
import { githubRevertPullAction } from './github-revert';
import { gmailSendAction } from './gmail-send';
import { hubspotUpdateAction } from './hubspot-update';
import { learningAdoptRuleAction } from './learning-adopt-rule';
import { missionUpdateNotesAction } from './mission-update-notes';
import { objectsCreateGroupAction } from './objects-create-group';
import { objectProposeCandidateAction } from './objects-propose-candidate';
import { objectsRenameAction } from './objects-rename';
import { objectsUpdateMetaAction } from './objects-update-meta';
import { personalizationEnrollAction } from './personalization-enroll';
import { playbookWriteAction } from './playbook-write';
import { pluginEnableAction } from './plugin-enable';
import { qcActions } from './qc';
import { repoCancelPipelineRunAction } from './repo-cancel-pipeline-run';
import { repoCommentPullAction } from './repo-comment-pull';
import { repoSubmitReviewAction } from './repo-submit-review';
import { restRequestAction } from './rest';
import { slackPostMessageAction } from './slack-post-message';
import { sourceConnectAction } from './source-connect';
import { teamHireAgentAction } from './team-hire-agent';
import { trackerAttachFileAction } from './tracker-attach-file';
import { trackerCommentAction } from './tracker-comment';
import { trackerCreateIssueAction } from './tracker-create-issue';
import { trackerTransitionIssueAction } from './tracker-transition-issue';
import { trackerUpdateIssueAction } from './tracker-update-issue';
import { wikiWritePageAction } from './wiki-write-page';
import { workspaceDescribeAction } from './workspace-describe';
import { workspaceWriteOperatingIntentAction } from './workspace-operating-intent';
import { workspaceWriteMissionAction, workspaceWritePlaybookAction } from './workspace-source';

const registry = new Map<string, Action>();
/** A former id → the id it is registered under now (`Action.aliases`). */
const aliases = new Map<string, string>();

export function registerAction(action: Action): void {
  registry.set(action.id, action);
  for (const alias of action.aliases ?? []) {
    aliases.set(alias, action.id);
  }
}

/**
 * The action behind an id — its own, or one it used to carry. A run stored
 * under a former id, a rule a workspace wrote against it and a grant that
 * names it all resolve to the same action.
 * @param id - An action id, current or former.
 */
export function getAction(id: string): Action | undefined {
  return registry.get(id) ?? registry.get(aliases.get(id) ?? '');
}

/**
 * The id an action is registered under now, for an id that may be a former one.
 * @param id - An action id, current or former.
 */
export function canonicalActionId(id: string): string {
  return registry.has(id) ? id : (aliases.get(id) ?? id);
}

/**
 * The former ids of an action, for a reader that matches rules or grants by
 * name and must accept what a workspace wrote before the rename.
 * @param id - An action id, current or former.
 */
export function aliasesOf(id: string): readonly string[] {
  return getAction(id)?.aliases ?? [];
}

export function listActions(): Action[] {
  return Array.from(registry.values());
}

// Built-ins.
registerAction(gmailSendAction);
registerAction(hubspotUpdateAction);
// A write to any `rest` source through an endpoint it declares — external,
// not reversible, keyed per endpoint on the ladder (`rest.request.<source>.<action>`).
registerAction(restRequestAction);
// A message to a Slack channel the workspace bound — external, Undo deletes
// the post, the words editable on the card (`libs/actions/slack-post-message.ts`).
registerAction(slackPostMessageAction);
// A reply in the thread an ask came from, and a reaction on its message — the
// chat family's other two writes; both reversible (`libs/actions/chat-*.ts`).
registerAction(chatReplyInThreadAction);
registerAction(chatAddReactionAction);
registerAction(discoveryReviewProposalAction);
registerAction(personalizationEnrollAction);
registerAction(objectProposeCandidateAction);
// An agent writes declared fields on a record that exists — reversible (the
// previous values ride the run), low-risk, done-for-you above the bar. The
// record's write history is these runs.
registerAction(objectsUpdateMetaAction);
registerAction(objectsRenameAction);
// A parent record and its children in one tap, deduped, all or nothing (`objects-create-group.ts`).
registerAction(objectsCreateGroupAction);
// Start the build: approve the plan, queue the engineer on the task contract.
registerAction(factoryDispatchAction);
registerAction(factoryApprovePlanAction);
// A person asks QA to check a release on the live product again, a fresh round (`factory-check-live.ts`).
registerAction(factoryCheckLiveAgainAction);
registerAction(factoryReadAttemptAction);
registerAction(factoryStopRequestAction);
registerAction(factoryReadReleaseLiveAction);
// Re-run a red CI's failed jobs once — changes no code, Undo cancels it while
// it runs; done for you on the software factory's trust ladder (backlog 049).
registerAction(githubRerunFailedJobsAction);
// The pipeline's owner opens its own fix — files as one commit on a
// vocion/pipeline-… branch and its pull request, merged on green under
// git.merge.pipeline; Undo closes it or reverts it (backlog 049).
registerAction(githubOpenPullAction);
// A deploy that should have run, or a redeploy of what is merged, started
// with workflow_dispatch; Undo cancels the run while it runs (backlog 049).
registerAction(githubDispatchWorkflowAction);
// A release that took an environment down, reverted and merged on green
// (git.merge.rollback); Undo puts it back (backlog 049).
registerAction(githubRevertPullAction);
// A comment on a pull request — the run report, why a check is red — on the
// connected code host; Undo deletes it (`libs/actions/repo-comment-pull.ts`).
registerAction(repoCommentPullAction);
// QA's verdict mirrored as a review on the pull request, findings inline;
// Undo dismisses it (`libs/actions/repo-submit-review.ts`).
registerAction(repoSubmitReviewAction);
// A pipeline run that should not be running, stopped; Undo starts it again
// (`libs/actions/repo-cancel-pipeline-run.ts`).
registerAction(repoCancelPipelineRunAction);
// The tracker family's writes on the connected issue tracker (Jira first):
// an issue filed from a request, a status transition, fields, a comment and an
// attachment — each with its Undo (`services/tracker/provider.ts`).
registerAction(trackerCreateIssueAction);
registerAction(trackerTransitionIssueAction);
registerAction(trackerUpdateIssueAction);
registerAction(trackerCommentAction);
registerAction(trackerAttachFileAction);
// An agent puts a question in front of a person, and takes it back when the
// thing it asked about went away. Both reversible and internal: the ask is
// the outcome, nothing executes on the answer.
registerAction(askFileAction);
registerAction(askWithdrawAction);
// Turn a workspace plugin on/off from chat — reversible, internal, done-for-you above the bar.
registerAction(pluginEnableAction);
// Save what the workspace is for — reversible, internal; the setup conversation proposes it first.
registerAction(workspaceDescribeAction);
// A source saved from what the person picked, on their login; reversible until it syncs (`services/connect/createSourceOnLogin.ts`).
registerAction(sourceConnectAction);
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

/**
 * THE FIELDS EACH ACTION TAKES, for a model that has to fill them in.
 *
 * Every refused card on 2026-09-25 (finding 20) was a field name guessed
 * wrong: `object_type` for `objectType`, no `title`/`summary` on a manual
 * action, a task id as a string. The registry knows the shapes; this reads
 * them off the zod schemas so the recommend_action tool's description and
 * the card backstop can say them, and the guessing stops.
 * @param ids - The actions to describe; every registered action when omitted.
 */
export function actionInputHints(ids?: readonly string[]): string {
  const actions = ids ? ids.map(id => registry.get(id)).filter((a): a is Action => !!a) : listActions();
  return actions.map((a) => {
    const shape = objectShape(a.inputSchema);
    if (!shape) {
      return `${a.id}: (see the action's description)`;
    }
    const alsoRequired = new Set((a as { inputRequired?: readonly string[] }).inputRequired ?? []);
    const fields = Object.entries(shape).map(([key, field]) => `${key}${isOptionalField(field) && !alsoRequired.has(key) ? '' : '*'}${valueHint(field)}`);
    return `${a.id}: ${fields.join(', ')}`;
  }).join('\n');
}

/**
 * The object shape behind a schema, through refinements and effects; null when it is not an object.
 * @param schema
 */
function objectShape(schema: unknown): Record<string, unknown> | null {
  let s = schema as { shape?: Record<string, unknown>; _def?: { schema?: unknown; innerType?: unknown; typeName?: string }; innerType?: () => unknown } | undefined;
  for (let i = 0; i < 6 && s; i += 1) {
    if (s.shape && typeof s.shape === 'object') {
      return s.shape;
    }
    const next = (typeof s.innerType === 'function' ? s.innerType() : undefined) ?? s._def?.schema ?? s._def?.innerType;
    if (!next || next === s) {
      break;
    }
    s = next as typeof s;
  }
  return null;
}

/**
 * What a field takes, when a name alone is not enough: an enum's options, a
 * number, a boolean, a list. Every refusal left after the names were fixed
 * (2026-09-25) was a value — `kind: "build"` for an enum, a cost as a string.
 * @param field - The zod field, possibly wrapped in optional/default/effects.
 */
function valueHint(field: unknown): string {
  // zod 4: `_def.type` is the kind ('optional', 'default', 'enum', …),
  // `_def.innerType` unwraps, an enum's options sit in `_def.entries`.
  let f = field as { _def?: { type?: string; typeName?: string; innerType?: unknown; schema?: unknown; entries?: Record<string, unknown>; values?: unknown[]; element?: unknown } } | undefined;
  for (let i = 0; i < 6 && f?._def; i += 1) {
    const t = f._def.type ?? f._def.typeName;
    if (t === 'enum' || t === 'ZodEnum') {
      const values = f._def.entries ? Object.values(f._def.entries) : (f._def.values ?? []);
      return values.length > 0 ? `=${values.join('|')}` : '';
    }
    if (t === 'number' || t === 'ZodNumber') {
      return '=number';
    }
    if (t === 'boolean' || t === 'ZodBoolean') {
      return '=true|false';
    }
    if (t === 'array' || t === 'ZodArray') {
      // One level down: an array of objects says its element's fields —
      // `objectRefs.0.type … received undefined` was the refusal left on
      // walk 19 (2026-09-25) once the top-level names and values were right.
      const element = (f._def as { element?: unknown }).element;
      const inner = element ? objectShape(element) : null;
      if (inner) {
        const keys = Object.entries(inner).map(([k, v]) => `${k}${isOptionalField(v) ? '' : '*'}${valueHint(v) === '=[…]' || valueHint(v).startsWith('={') ? '' : valueHint(v)}`);
        return `=[{${keys.join(', ')}}]`;
      }
      return '=[…]';
    }
    if (t === 'object' || t === 'record' || t === 'ZodObject' || t === 'ZodRecord') {
      return '={…}';
    }
    const next = f._def.innerType ?? f._def.schema;
    if (!next || next === f) {
      break;
    }
    f = next as typeof f;
  }
  return '';
}

function isOptionalField(field: unknown): boolean {
  const f = field as { isOptional?: () => boolean; _def?: { typeName?: string } };
  try {
    return typeof f.isOptional === 'function' ? f.isOptional() : false;
  } catch {
    return false;
  }
}
