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
      'x-display': { tones: { new: 'muted', triaged: 'muted', deciding: 'warn', queued: 'muted', deferred: 'muted', planning: 'info', building: 'info', in_qa: 'info', changes_asked: 'warn', awaiting_merge: 'warn', deploying: 'info', stopped: 'bad', shipped: 'ok', seen_live: 'ok', answered: 'muted', out_of_scope: 'muted', duplicate: 'muted' } },
      'x-labels': { new: 'Not triaged', triaged: 'Triaged', deciding: 'Decide', queued: 'Queued', deferred: 'Deferred', planning: 'Planning', building: 'Building', in_qa: 'In QA', changes_asked: 'Changes asked', awaiting_merge: 'Waiting on your merge', deploying: 'Deploying', stopped: 'Stopped · needs you', shipped: 'Shipped', seen_live: 'Shipped · seen live', answered: 'Answered', out_of_scope: 'Out of scope', duplicate: 'Duplicate' },
      'x-groups': [
        { key: 'progress', label: 'In progress', role: 'progress', default: true, in: ['planning', 'building', 'in_qa', 'changes_asked', 'awaiting_merge', 'deploying', 'stopped'] },
        { key: 'proposed', label: 'Proposed', role: 'proposed', in: ['new', 'triaged', 'deciding', 'queued', 'deferred'], last: ['deferred'] },
        { key: 'done', label: 'Done', role: 'done', in: ['shipped', 'seen_live', 'answered'] },
        { key: 'archived', label: 'Archived', role: 'archived', in: ['out_of_scope', 'duplicate'] },
      ],
      'x-needs-you': ['deciding', 'changes_asked', 'awaiting_merge', 'stopped'],
      'x-transitions': { 'created': 'new', 'recommended': 'deciding', 'build_card': 'deciding', 'starting': 'building', 'planning': 'planning', 'building': 'building', 'review': 'in_qa', 'deploying': 'deploying', 'merged': 'deploying', 'live': 'seen_live', 'live_unconfirmed': 'shipped', 'live_unchecked': 'shipped', 'stopped': 'stopped', 'qa_changes': 'changes_asked', 'qa_reject': 'changes_asked', 'live_changes': 'changes_asked', 'merge_waits': 'awaiting_merge', 'merge_running': 'deploying', 'shipped': 'shipped', 'live_seen': 'seen_live', 'resolved': 'answered', 'duplicateOf:*': 'duplicate', 'recommendationState:rejected': 'out_of_scope', 'state:out_of_scope': 'out_of_scope', 'state:shipped': 'shipped', 'state:answered': 'answered', 'state:deferred': 'deferred', 'recommendationState:deferred': 'deferred', 'state:building': 'building', 'recommendationState:proposed': 'deciding', 'recommendationState:approved': 'queued', 'state:in_scope': 'queued', 'state:triaged': 'triaged', 'state:new': 'new' },
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
