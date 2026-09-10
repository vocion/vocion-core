/**
 * The scheduled-check brief is what a mission check actually reads. An
 * event-when automation's payload has to reach it, or the check does not know
 * which lead replied; a schedule fire has no payload and must not grow a
 * block that says so.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { scheduledCheckBrief } = await import('@/services/MissionService');

const TEMPLATE = { name: 'Increase discovery calls', goal: 'Book qualified discovery calls.', successCriteria: ['Every MQL briefed.'] };

describe('scheduledCheckBrief', () => {
  it('carries an event payload verbatim, and says the check is event-triggered', () => {
    const brief = scheduledCheckBrief(TEMPLATE, 'Write the handoff brief.', {
      contactRef: 'contacts:9412',
      trigger: 'reply',
      observedAt: '2026-09-09T15:30:00.000Z',
    });

    expect(brief).toContain('Event-triggered check of your standing mission "Increase discovery calls".');
    expect(brief).toContain('TRIGGER PAYLOAD, the event that started this check (JSON):');
    expect(brief).toContain('"contactRef": "contacts:9412"');
    expect(brief).toContain('"trigger": "reply"');
    expect(brief).toContain('YOUR ORDERS FOR THIS CHECK:\nWrite the handoff brief.');
  });

  it('stays a scheduled check with no payload block when there is no payload', () => {
    for (const payload of [undefined, {}]) {
      const brief = scheduledCheckBrief(TEMPLATE, 'Sweep the queue.', payload);

      expect(brief).toContain('Scheduled check of your standing mission');
      expect(brief).not.toContain('TRIGGER PAYLOAD');
    }
  });
});
