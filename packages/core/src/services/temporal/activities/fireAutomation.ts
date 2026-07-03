/**
 * fireAutomation activity — dispatches an automation's `do` in the worker
 * process (full deps: workflow runner incl. agent steps, mission checks).
 */

import { fireAutomation } from '@/services/AutomationService';

export type FireAutomationActivityInput = {
  orgId: string;
  slug: string;
};

export async function fireAutomationActivity(
  input: FireAutomationActivityInput,
): Promise<{ kind: string; runId: number }> {
  return fireAutomation(input.orgId, input.slug, { invokedBy: `automation:${input.slug}` });
}
