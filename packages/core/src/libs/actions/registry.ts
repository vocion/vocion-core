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
