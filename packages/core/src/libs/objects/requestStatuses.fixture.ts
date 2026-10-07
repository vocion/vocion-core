import type { PageRow } from '@/libs/workspace/pageFields';
import { readStatusModel, withFollowedStatus } from './statusModel';

/**
 * The software factory's request status, for tests that run where the plugin's
 * YAML cannot be read (the browser project). `statusModel.test.ts` holds it
 * equal to `templates/plugins/software-factory/objects/request/type.yaml`, so
 * it cannot drift from the type.
 */
const REQUEST_STATUS_SCHEMA = {
  type: 'object',
  properties: {
    status: {
      'x-display': {
        label: 'Status',
        format: 'badge',
        group: 'Triage',
        tones: {
          new: 'muted',
          triaged: 'muted',
          deciding: 'warn',
          queued: 'muted',
          deferred: 'muted',
          planning: 'info',
          awaiting_plan: 'warn',
          building: 'info',
          in_qa: 'info',
          changes_asked: 'warn',
          awaiting_merge: 'warn',
          deploying: 'info',
          stopped: 'bad',
          shipped: 'ok',
          seen_live: 'ok',
          answered: 'muted',
          out_of_scope: 'muted',
          duplicate: 'muted',
        },
      },
      'x-labels': {
        new: 'Not triaged',
        triaged: 'Triaged',
        deciding: 'Decide',
        queued: 'Queued',
        deferred: 'Deferred',
        planning: 'Planning',
        awaiting_plan: 'Waiting on your plan approval',
        building: 'Building',
        in_qa: 'In QA',
        changes_asked: 'Changes asked',
        awaiting_merge: 'Waiting on your merge',
        deploying: 'Deploying',
        stopped: 'Stopped · needs you',
        shipped: 'Shipped',
        seen_live: 'Shipped · seen live',
        answered: 'Answered',
        out_of_scope: 'Out of scope',
        duplicate: 'Duplicate',
      },
      'x-groups': [
        {
          key: 'progress',
          label: 'In progress',
          role: 'progress',
          default: true,
          in: [
            'planning',
            'awaiting_plan',
            'building',
            'in_qa',
            'changes_asked',
            'awaiting_merge',
            'deploying',
            'stopped',
          ],
        },
        {
          key: 'proposed',
          label: 'Proposed',
          role: 'proposed',
          in: [
            'new',
            'triaged',
            'deciding',
            'queued',
            'deferred',
          ],
          last: [
            'deferred',
          ],
        },
        {
          key: 'done',
          label: 'Done',
          role: 'done',
          in: [
            'shipped',
            'seen_live',
            'answered',
          ],
        },
        {
          key: 'archived',
          label: 'Archived',
          role: 'archived',
          in: [
            'out_of_scope',
            'duplicate',
          ],
        },
      ],
      'x-needs-you': [
        'deciding',
        'awaiting_plan',
        'changes_asked',
        'awaiting_merge',
        'stopped',
      ],
      'x-tell': {
        stopped: 'Blocked, and it needs you: {line}',
        plan_waits: 'The plan is ready, and it waits on your approval. {line}',
        merge_waits: 'Ready to merge, and the merge waits on you. {line}',
        live: 'Done ✅ "{title}" is live in production and checked. {line}',
        live_seen: 'Done ✅ "{title}" is live in production and checked. {line}',
        live_unconfirmed: 'Live in production: "{title}". The live check could not confirm all of it. {line}',
        live_unchecked: 'Live in production: "{title}". It could not be checked live yet. {line}',
        resolved: 'Answered: {line}',
      },
      'x-transitions': {
        'created': 'new',
        'recommended': 'deciding',
        'build_card': 'deciding',
        'starting': 'building',
        'planning': 'planning',
        'building': 'building',
        'review': 'in_qa',
        'deploying': 'deploying',
        'merged': 'deploying',
        'live': 'seen_live',
        'live_unconfirmed': 'shipped',
        'live_unchecked': 'shipped',
        'stopped': 'stopped',
        'qa_changes': 'changes_asked',
        'qa_reject': 'changes_asked',
        'live_changes': 'changes_asked',
        'merge_waits': 'awaiting_merge',
        'plan_waits': 'awaiting_plan',
        'merge_running': 'deploying',
        'shipped': 'shipped',
        'live_seen': 'seen_live',
        'resolved': 'answered',
        'duplicateOf:*': 'duplicate',
        'recommendationState:rejected': 'out_of_scope',
        'state:out_of_scope': 'out_of_scope',
        'state:shipped': 'shipped',
        'state:answered': 'answered',
        'state:deferred': 'deferred',
        'recommendationState:deferred': 'deferred',
        'state:building': 'building',
        'recommendationState:proposed': 'deciding',
        'recommendationState:approved': 'queued',
        'state:in_scope': 'queued',
        'state:triaged': 'triaged',
        'state:new': 'new',
      },
      'type': 'string',
      'description': 'Where the request stands, in one field: Proposed (not triaged, triaged, decide, queued, deferred), In progress (planning, building, in QA, changes asked, waiting on your merge, deploying, stopped · needs you), Done (shipped, shipped · seen live, answered) or Archived (out of scope, duplicate). Written by the factory at each transition and by a person\'s own actions; agents do not set it by hand. `statusLine` says what is happening in a sentence, `statusAt` when it was written.',
      'enum': [
        'new',
        'triaged',
        'deciding',
        'queued',
        'deferred',
        'planning',
        'awaiting_plan',
        'building',
        'in_qa',
        'changes_asked',
        'awaiting_merge',
        'deploying',
        'stopped',
        'shipped',
        'seen_live',
        'answered',
        'out_of_scope',
        'duplicate',
      ],
    },
  },
};

export const REQUEST_STATUSES = readStatusModel(REQUEST_STATUS_SCHEMA)!;

/**
 * A request row as the factory leaves it: a given `state` carries the status
 * a write of it carries (the type's `state:` transitions); a given `status` stays.
 * @param row - The row.
 */
export function withRequestStatus<T extends PageRow>(row: T): T {
  // Only the value: when it was written is the fixture's own business.
  const { statusAt: _at, statusLine: _line, ...meta } = withFollowedStatus(REQUEST_STATUSES, row.meta);
  return { ...row, meta: 'statusAt' in row.meta ? { ...meta, statusAt: row.meta.statusAt } : meta };
}
