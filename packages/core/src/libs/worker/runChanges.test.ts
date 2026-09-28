import { describe, expect, it } from 'vitest';
import { recordLinker, recordLinksOf } from '@/libs/workspace/recordHref';
import { reportLead, runChanges } from './runChanges';

/**
 * What an agent run is credited with filing or changing comes from the
 * sentence each tool wrote back, never from what the model said about it.
 * Outputs below are the tools' own wording (`services/agents/tools/*`).
 * @param tool
 * @param input
 * @param output
 * @param error
 */
const call = (tool: string, input: Record<string, unknown>, output: string | null, error: string | null = null) => ({ tool, input, output, error });

describe('what a run filed or changed', () => {
  it('reads each write the tool reported, with a link to the record', () => {
    expect(runChanges([
      call('update_object', { object_type: 'engineering_task', id: 77 }, 'engineering_task #77 "Room PDF export" updated — status written (run #3, confidence 0.9). Done for you.'),
      call('propose_action', { action_id: 'objects.propose_candidate' }, 'objects.propose_candidate is DONE (run #4, confidence 0.9) — it was reversible. Result: {"mode":"recorded","objectId":130,"objectType":"request"}'),
      call('propose_action', { action_id: 'factory.dispatch_task' }, 'factory.dispatch_task is DONE (run #5, confidence 0.9) — it ran. Result: {"workerRunId":502,"agentSlug":"task-engineer","taskId":77}'),
      call('file_ask', { title: 'Which rooms first?' }, 'Ask #88 filed (question, run #6). A person decides it there.'),
      call('record_verdict', {}, 'Verdict recorded on task #77: approve, 3 of 3, at abc123def456. The merge card is filed.'),
      call('render_markdown', {}, 'Rendered markdown "Release notes" (2 sections), now open beside the conversation at v1. To change it later call update_artifact(640, …) rather than rendering a second one.'),
    ])).toEqual([
      { text: 'Updated engineering task #77 "Room PDF export"', href: '/dashboard/objects/77' },
      { text: 'Filed request #130', href: '/dashboard/objects/130' },
      { text: 'Ran dispatch task — engineering run #502', href: '/dashboard/p/runs/502' },
      { text: 'Filed ask #88 "Which rooms first?"', href: '/dashboard/inbox/ask%3A88' },
      { text: 'Recorded a verdict on task #77: approve', href: '/dashboard/objects/77' },
      { text: 'Made markdown "Release notes"', href: '/dashboard/artifacts/640' },
    ]);
  });

  it('says a write that waits for a person is waiting, and never counts a refusal, a failure or a read', () => {
    expect(runChanges([
      call('update_object', { object_type: 'request', id: 41 }, 'Update to request #41 (priority) is PENDING a person\'s decision (run #7, confidence 0.4 was under the bar). Do NOT say the record changed.'),
      call('propose_action', { action_id: 'git.merge' }, 'Proposed git.merge → action run #8 is PENDING human approval in the review queue (confidence 0.7).'),
      call('update_object', { object_type: 'request', id: 42 }, 'Update refused (forbidden): nope'),
      call('update_object', { object_type: 'request', id: 43 }, null, 'boom'),
      call('read_object', { id: 41 }, '{"id":41}'),
    ])).toEqual([
      { text: 'Proposed a change to request #41 — waiting for a person', href: '/dashboard/objects/41' },
      { text: 'Proposed merge — waiting for a person', href: null },
    ]);
  });

  it('names a record written five times once, at its last write', () => {
    const write = (n: number) => call('update_object', { object_type: 'request', id: 41 }, `request #41 "v${n}" updated — state written (run #${n}).`);
    const out = runChanges([write(1), call('file_ask', {}, 'Ask #9 filed (question, run #2).'), write(2)]);

    expect(out.map(o => o.text)).toEqual(['Filed ask #9', 'Updated request #41 "v2"']);
  });

  it('links each record to the page its workspace opens it at (#827)', () => {
    const link = recordLinker(recordLinksOf([{ slug: 'feature', archetype: 'report', report: { subject: 'request' } } as never], 'fixture-factory'));
    const out = runChanges([call('update_object', { object_type: 'request', id: 41 }, 'request #41 updated — state written (run #1).')], link);

    expect(out[0]!.href).toBe('/w/fixture-factory/dashboard/p/feature/41');
  });
});

describe('the first lines of a run\'s report', () => {
  it('drops headings and marks, keeps two lines, cuts at a sentence', () => {
    expect(reportLead('## Verdict\n\n**Filed** request #41 as in scope.\n\nMore after.')).toBe('Verdict Filed request #41 as in scope.');
    expect(reportLead(`${'A long sentence that keeps going. '.repeat(20)}`, 80)).toBe('A long sentence that keeps going. A long sentence that keeps going.');
    expect(reportLead('\n\n')).toBeNull();
  });
});
