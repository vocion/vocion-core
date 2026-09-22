/**
 * Refusing eval checks that point at arguments a tool never takes.
 *
 * A `toolCalledWith` path is a string, and nothing used to read it before a
 * run. `action_input.feilds.startDate` applied cleanly, then failed every case
 * with "was missing" — which reads exactly like an agent that forgot the
 * field. This runs inside `loadWorkspace`, so `workspace:apply` and the
 * pull-request job that runs `validate-workspace.sh` both refuse the file
 * before anything reaches a database or a model.
 *
 * What it knows is what core can know offline:
 *
 * - `propose_action`'s own arguments, from `proposeActionArgsSchema`;
 * - the `objects.propose_candidate` envelope inside `action_input`, from
 *   `candidateInputShape`;
 * - `action_input.fields.*`, from the workspace's own object types — the one
 *   named by a `where` on `action_input.objectType`, or any of them when the
 *   check names none.
 *
 * Tools whose arguments are not known here are not checked. A path deeper
 * than a field name (into an object a field holds) is not checked either,
 * because object type schemas rarely describe that far.
 */

import type { LoadedEvalDataset, LoadedObjectType } from './loader';
import type { EvalCheck, ToolCallFilter } from '@/services/evals/types';
import { candidateInputShape } from '@/libs/actions/objects-propose-candidate';
import { proposeActionArgsSchema } from '@/libs/actions/proposeActionArgs';

const PROPOSE_ACTION = 'propose_action';
const PROPOSE_CANDIDATE = 'objects.propose_candidate';
const PROPOSE_ACTION_ARGUMENTS = Object.keys(proposeActionArgsSchema.shape);
const CANDIDATE_INPUT_KEYS = Object.keys(candidateInputShape.shape);

/** One path a check reads, and the words a problem uses for where it came from. */
type PathToCheck = { path: string; role: string };

/**
 * The `propose_action` rule a check makes, pulled into one shape.
 * @param check - One check from a case.
 */
function argumentRule(check: EvalCheck): { tool: string; where: ToolCallFilter[]; paths: PathToCheck[] } | null {
  if (!('toolCalledWith' in check)) {
    return null;
  }
  const condition = check.toolCalledWith;
  const where = condition.where === undefined ? [] : Array.isArray(condition.where) ? condition.where : [condition.where];
  const paths: PathToCheck[] = [];
  if (condition.path) {
    paths.push({ path: condition.path, role: 'path' });
  }
  for (const filter of where) {
    paths.push({ path: filter.path, role: 'where path' });
  }
  if (condition.timezoneFrom) {
    paths.push({ path: condition.timezoneFrom, role: 'timezoneFrom' });
  }
  return { tool: condition.tool, where, paths };
}

/**
 * The value a `where` filter pins a path to, when one does.
 * @param where - The check's filters.
 * @param path - The path to look for.
 */
function pinnedValue(where: ToolCallFilter[], path: string): unknown {
  return where.find(filter => filter.path === path && filter.equals !== undefined)?.equals;
}

/**
 * The property names an object type's JSON Schema declares.
 * @param objectType - One loaded object type.
 */
function fieldNamesOf(objectType: LoadedObjectType): string[] {
  const properties = (objectType.schema as { properties?: Record<string, unknown> } | undefined)?.properties;
  return properties ? Object.keys(properties) : [];
}

/**
 * What is wrong with one `propose_action` path, or null when it resolves.
 * @param path - The dot path the check reads.
 * @param where - The check's filters, which may pin the action and object type.
 * @param objectTypes - The workspace's object types.
 */
function proposeActionPathProblem(path: string, where: ToolCallFilter[], objectTypes: LoadedObjectType[]): string | null {
  const [argument, envelopeKey, fieldName] = path.split('.');
  if (!PROPOSE_ACTION_ARGUMENTS.includes(argument!)) {
    return `propose_action takes no argument "${argument}"; it takes ${PROPOSE_ACTION_ARGUMENTS.join(', ')}`;
  }
  if (argument !== 'action_input' || envelopeKey === undefined) {
    return null;
  }

  // Only objects.propose_candidate has a known envelope. A check pinned to a
  // different action is about a payload this file cannot see.
  const actionId = pinnedValue(where, 'action_id');
  if (actionId !== undefined && actionId !== PROPOSE_CANDIDATE) {
    return null;
  }
  if (!CANDIDATE_INPUT_KEYS.includes(envelopeKey)) {
    return `action_input has no "${envelopeKey}" for ${PROPOSE_CANDIDATE}; it takes ${CANDIDATE_INPUT_KEYS.join(', ')}`;
  }
  if (envelopeKey !== 'fields' || fieldName === undefined) {
    return null;
  }

  const pinnedType = pinnedValue(where, 'action_input.objectType');
  if (pinnedType !== undefined) {
    const objectType = objectTypes.find(candidate => candidate.slug === pinnedType);
    if (!objectType) {
      return `where names object type "${String(pinnedType)}", which this workspace does not define`;
    }
    const names = fieldNamesOf(objectType);
    // A type with no declared properties accepts any field, so there is
    // nothing to hold the name against.
    if (names.length > 0 && !names.includes(fieldName)) {
      return `object type "${objectType.slug}" has no field "${fieldName}"; its fields are ${names.join(', ')}`;
    }
    return null;
  }

  const described = objectTypes.filter(objectType => fieldNamesOf(objectType).length > 0);
  if (described.length > 0 && !described.some(objectType => fieldNamesOf(objectType).includes(fieldName))) {
    return `no object type in this workspace has a field "${fieldName}" (add a where on action_input.objectType to check against one type)`;
  }
  return null;
}

/**
 * Throw when any eval check reads a `propose_action` argument that does not
 * exist, listing every one found rather than stopping at the first, the
 * same way unresolved skill and playbook references are reported.
 * @param evalDatasets - Every dataset the workspace declares.
 * @param objectTypes - Every object type the workspace declares.
 */
export function assertEvalCheckPaths(evalDatasets: LoadedEvalDataset[], objectTypes: LoadedObjectType[]): void {
  const problems: string[] = [];
  for (const dataset of evalDatasets) {
    dataset.items.forEach((item, itemIndex) => {
      (item.checks ?? []).forEach((check, checkIndex) => {
        const rule = argumentRule(check as EvalCheck);
        if (!rule || rule.tool !== PROPOSE_ACTION) {
          return;
        }
        for (const { path, role } of rule.paths) {
          const problem = proposeActionPathProblem(path, rule.where, objectTypes);
          if (problem) {
            problems.push(`eval dataset "${dataset.slug}" case ${itemIndex + 1} check ${checkIndex + 1}: ${role} "${path}" — ${problem}`);
          }
        }
      });
    });
  }
  if (problems.length > 0) {
    throw new Error(`eval checks read arguments that do not exist:\n  - ${problems.join('\n  - ')}`);
  }
}
