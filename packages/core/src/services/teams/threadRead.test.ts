/**
 * The two typed reads a team thread routes on: did a member say its part is
 * complete, did the lead settle the thread. A model reads the words and
 * returns the field through a tool; code routes on the field. A read that
 * fails, or returns nothing typed, is a "no" — the thread then runs on to its
 * next rule, which every thread has.
 */
import { describe, expect, it } from 'vitest';
import { readLeadReview, readMemberPost } from './threadRead';

/**
 * A model that answers through the tool it was bound to with the given args, and keeps what it was asked.
 * @param args - The tool call's arguments, or a function that throws.
 */
function model(args: Record<string, unknown> | (() => never)) {
  const asked: { tool?: string; text: string }[] = [];
  return {
    asked,
    bindTools(tools: Array<{ name: string }>, opts: { tool_choice: string }) {
      return {
        async invoke(messages: Array<{ content: unknown }>) {
          asked.push({ tool: opts.tool_choice, text: messages.map(m => String(m.content)).join('\n') });
          if (typeof args === 'function') {
            args();
          }
          return { tool_calls: [{ name: tools[0]!.name, args }] };
        },
      };
    },
  };
}

describe('readMemberPost', () => {
  it('returns the typed field the model reported', async () => {
    const m = model({ complete: true });

    const read = await readMemberPost({ orgId: 'org_reads', member: 'pipeline-analyst', question: 'Will Northwind renew?', post: 'That is everything from my side.' }, m as never);

    expect(read).toEqual({ complete: true });
    expect(m.asked[0]!.tool).toBe('report_post');
    expect(m.asked[0]!.text).toContain('That is everything from my side.');
  });

  it('reads a failed call, or an answer that is not the typed field, as not complete', async () => {
    const failing = model(() => {
      throw new Error('model unavailable');
    });

    expect(await readMemberPost({ orgId: 'org_reads', member: 'pipeline-analyst', question: 'q', post: 'p' }, failing as never)).toEqual({ complete: false, unread: true });
    expect(await readMemberPost({ orgId: 'org_reads', member: 'pipeline-analyst', question: 'q', post: 'p' }, model({ complete: 'yes' }) as never)).toEqual({ complete: false, unread: true });
  });
});

describe('readLeadReview', () => {
  it('returns whether the lead settled it', async () => {
    const m = model({ settled: true });

    const read = await readLeadReview({ orgId: 'org_reads', lead: 'revenue-lead', question: 'Will Northwind renew?', review: 'Settled: send the terms by Thursday.' }, m as never);

    expect(read).toEqual({ settled: true });
    expect(m.asked[0]!.tool).toBe('report_review');
  });

  it('reads a failed call as not settled, so the thread goes on to its caps', async () => {
    const failing = model(() => {
      throw new Error('timeout');
    });

    expect(await readLeadReview({ orgId: 'org_reads', lead: 'revenue-lead', question: 'q', review: 'r' }, failing as never)).toEqual({ settled: false, unread: true });
  });
});
