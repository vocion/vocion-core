/**
 * Approval signal for HITL pauses (Phase H.3).
 *
 * When a workflow hits an `approve` step it:
 *   1. Calls `recordApprovalRequestedActivity()` to update the
 *      Postgres mirror with `status='paused'` for the UI.
 *   2. Awaits this Signal via `workflow.condition()`.
 *   3. Branches on `approved` — continue or end-with-cancel.
 *
 * The client side (`WorkflowService.resumeWorkflow()`) signals
 * this name with `{ approved, note?, reviewer? }`.
 */

import { defineSignal } from '@temporalio/workflow';

export type ApprovalPayload = {
  approved: boolean;
  note?: string;
  reviewer?: string;
};

export const approvalSignal = defineSignal<[ApprovalPayload]>('approval');

export const APPROVAL_SIGNAL_NAME = 'approval';
