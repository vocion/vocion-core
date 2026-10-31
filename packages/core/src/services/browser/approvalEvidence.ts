import type { BrowserStep } from '@/libs/browser/run';

/**
 * A checkpoint may contain the old product name. Both receipts mean a write
 * was authorized; uncertain outcomes must never become replayable on rename.
 * @param steps - Persisted browser steps.
 */
export function wroteAfterApproval(steps: Pick<BrowserStep, 'kind' | 'ok' | 'label'>[]): boolean {
  return steps.some(s => s.kind === 'approval' && s.ok && /^(?:Approved by the person|Inside the (?:routine|automation)|Approved ahead)/.test(s.label));
}
