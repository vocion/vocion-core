import { describe, expect, it } from 'vitest';
import { proposeResultOf, turnFollowups } from './turnFollowups';

describe('what a turn set moving, to watch (Chris, 2026-09-29, request #201)', () => {
  it('a done action names the run it started and the records it touched, from its result', () => {
    const out = 'factory.dispatch_task is DONE (run #5301, confidence 0.95) — it was reversible and above the bar, so it ran without waiting. Result: {"workerRunId":419,"taskId":243,"createdTaskId":243,"planId":230,"requestId":201}';

    expect(turnFollowups([{ type: 'tool', name: 'propose_action', input: { action_id: 'factory.dispatch_task' }, output: out }]).map(f => [f.label, f.ref.type, f.ref.id])).toEqual([
      ['RUN-419', 'worker_run', '419'],
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
    ]).map(f => f.label)).toEqual(['ASK-88']);
    expect(turnFollowups(undefined)).toEqual([]);
  });

  it('leaves out what the page already shows: the page\'s record, and a decision only about it — but keeps the run it started', () => {
    const decided = 'Decided ask #221 "Stopped: Document detail page": approve (approved). About: request #201. It leaves Needs you now.';
    const dispatched = 'factory.dispatch_task is DONE (run #5301, confidence 0.95) — ran. Result: {"workerRunId":419,"requestId":201}';
    const runs = [
      { type: 'tool', name: 'decide_ask', output: decided },
      { type: 'tool', name: 'propose_action', input: { action_id: 'factory.dispatch_task' }, output: dispatched },
    ];

    expect(turnFollowups(runs, { exclude: [{ type: 'object', id: '201' }] }).map(f => `${f.ref.type}:${f.ref.id}`)).toEqual(['worker_run:419']);
  });

  it('a record the turn changed that is not the page gets a chip; the page itself does not', () => {
    const runs = [
      { type: 'tool', name: 'update_object', input: { object_type: 'engineering_task', id: 243 }, output: 'engineering_task #243 "Scope reads" updated: status.' },
      { type: 'tool', name: 'update_object', input: { object_type: 'request', id: 201 }, output: 'request #201 "Document detail" updated: outcome.' },
      { type: 'tool', name: 'update_object', input: { object_type: 'request', id: 88 }, output: 'PENDING: a person approves the change to request #88.' },
      { type: 'tool', name: 'propose_action', input: { action_id: 'objects.update_meta', input: { objectType: 'release', id: 12, set: { notes: 'x' } } }, output: 'objects.update_meta is DONE (run #77, confidence 0.9) — ran. Result: {"set":{"notes":"x"}}' },
      { type: 'tool', name: 'update_artifact', input: { id: 515 }, output: 'Updated "Squatch Core" to v4.' },
    ];

    expect(turnFollowups(runs, { exclude: [{ type: 'object', id: '201' }] }).map(f => f.label)).toEqual(['engineering task #243', 'release #12', 'ART-515']);
  });

  it('a turn that only read, or only touched the page, ends with no chips', () => {
    const reads = [
      { type: 'tool', name: 'read_object', input: { id: 203 }, output: '{"id":203,"workerRunId":401}' },
      { type: 'tool', name: 'lookup_objects', output: '[{"id":215}]' },
      { type: 'tool', name: 'read_wiki_page', output: '# Squatch Core' },
    ];

    expect(turnFollowups(reads)).toEqual([]);
    expect(turnFollowups([{ type: 'tool', name: 'update_object', output: 'request #201 "Document detail" updated: outcome.' }], { exclude: [{ type: 'object', id: '201' }] })).toEqual([]);
  });
});
