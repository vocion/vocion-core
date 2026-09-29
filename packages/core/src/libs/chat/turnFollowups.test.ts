import { describe, expect, it } from 'vitest';
import { proposeResultOf, turnFollowups } from './turnFollowups';

describe('what a turn set moving, to watch (Chris, 2026-09-29, request #201)', () => {
  it('a done action names the run it started and the records it touched, from its result', () => {
    const out = 'factory.dispatch_task is DONE (run #5301, confidence 0.95) — it was reversible and above the bar, so it ran without waiting. Result: {"workerRunId":419,"taskId":243,"createdTaskId":243,"planId":230,"requestId":201}';

    expect(turnFollowups([{ type: 'tool', name: 'propose_action', input: { action_id: 'factory.dispatch_task' }, output: out }]).map(f => [f.label, f.ref.type, f.ref.id])).toEqual([
      ['run #419', 'worker_run', '419'],
      ['request #201', 'object', '201'],
      ['task #243', 'object', '243'],
      ['plan #230', 'object', '230'],
    ]);
  });

  it('a result the tool cut mid-value still gives up its ids', () => {
    expect(proposeResultOf('x is DONE (run #9, confidence 0.9) — ran. Result: {"workerRunId":419,"requestId":201,"previousTask":{"status":"read')).toEqual({ workerRunId: 419, requestId: 201 });
    expect(proposeResultOf('x is PENDING (run #9) — waiting.')).toBeNull();
  });

  it('a decided ask names itself and what it was about', () => {
    const out = 'Decided ask #221 "Stopped: Document detail page": approve (approved). About: request #201. It leaves Needs you now; say what it did in one sentence.';

    expect(turnFollowups([{ type: 'tool', name: 'decide_ask', output: out }]).map(f => `${f.ref.type}:${f.ref.id}`)).toEqual(['ask:221', 'object:201']);
  });

  it('reads nothing else, a failed step, or the same thing twice', () => {
    expect(turnFollowups([
      { type: 'text' },
      { type: 'tool', name: 'read_object', output: '{"workerRunId":401}' },
      { type: 'tool', name: 'decide_ask', output: 'Refused: already decided', state: 'error' },
      { type: 'tool', name: 'file_ask', output: 'Ask #88 filed on Needs you.' },
      { type: 'tool', name: 'decide_ask', output: 'Decided ask #88 "Ship it?": approve (approved).' },
    ]).map(f => f.label)).toEqual(['ask #88']);
    expect(turnFollowups(undefined)).toEqual([]);
  });
});
