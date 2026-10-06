import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { asRootRun } from './rootRun';

/**
 * A turn started from inside another turn's run outlives it (a chat turn's tool files a request;
 * the request's automation starts the designer). Real LangGraph, no model.
 */

const State = Annotation.Root({ n: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }) });

function child() {
  return new StateGraph(State).addNode('work', async () => ({ n: 1 })).addEdge(START, 'work').addEdge('work', END).compile();
}

/**
 * Run a parent graph whose node starts `later` without awaiting it, the way an event fires an
 * automation from inside a tool call; resolve with what `later` did once the parent has ended.
 * @param later - What the node starts.
 */
async function startedInside(later: () => Promise<unknown>): Promise<{ ok: boolean; error?: string }> {
  let pending!: Promise<{ ok: boolean; error?: string }>;
  const parent = new StateGraph(State).addNode('tool', async () => {
    pending = new Promise(resolve => setTimeout(() => {
      later().then(() => resolve({ ok: true }), (e: Error) => resolve({ ok: false, error: e.message }));
    }, 50));
    return { n: 1 };
  }).addEdge(START, 'tool').addEdge('tool', END).compile();
  const stream = await parent.streamEvents({ n: 0 }, { version: 'v2' });
  for await (const _ of stream) {
    // drain: the parent ends, and its controller aborts
  }
  return pending;
}

describe('asRootRun', () => {
  it('a graph started inside another run and outliving it runs to the end as its own root (FE-478: the designer aborted in 7 ms)', async () => {
    const drain = async () => {
      for await (const _ of await child().streamEvents({ n: 0 }, { version: 'v2' })) {
        // drain
      }
    };

    expect(await startedInside(() => asRootRun(drain))).toEqual({ ok: true });
    // Without it, the parent's ended run is inherited, and the child aborts: the bug this guards.
    expect(await startedInside(drain)).toMatchObject({ ok: false, error: expect.stringMatching(/abort/i) });
  });
});
