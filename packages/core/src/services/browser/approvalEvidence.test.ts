import { expect, it } from 'vitest';
import { wroteAfterApproval } from './approvalEvidence';

it.each(['Inside the routine’s approved steps', 'Inside the automation’s approved steps', 'Approved by the person', 'Approved ahead for this task'])('preserves write evidence from persisted approval receipt: %s', (label) => {
  const steps = JSON.parse(JSON.stringify([{ kind: 'approval', ok: true, label }]));

  expect(wroteAfterApproval(steps)).toBe(true);
});

it('does not treat a refusal, descriptive note or empty history as authorized write evidence', () => {
  expect(wroteAfterApproval([{ kind: 'approval', ok: false, label: 'Inside the routine' }])).toBe(false);
  expect(wroteAfterApproval([{ kind: 'note', ok: true, label: 'Inside the automation' }])).toBe(false);
  expect(wroteAfterApproval([])).toBe(false);
});
