/**
 * A scripted turn that dies part-way (#114).
 *
 * The product's behaviour when a run loses its model half way through an
 * answer — the fragment is kept, marked, and left out of the next turn's
 * history — could only be rehearsed end to end if a test could make a model
 * speak and then fail. `fails` on a script turn is that.
 */
import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { ScriptedChatModel } from './scripted';

const script = {
  turns: [
    {
      match: 'how many deals closed',
      steps: [],
      reply: 'Four deals closed last month, worth $216K.',
      fails: { after: 'Four deals closed last month, worth', reason: 'model connection reset' },
    },
    { match: 'who owns northwind', steps: [], reply: 'Pat owns it.' },
  ],
  fallback: 'no line for that',
};

/**
 * Read the whole stream for one line, returning the text spoken before any throw.
 * @param model
 * @param line
 */
async function speak(model: ScriptedChatModel, line: string): Promise<{ text: string; error: string | null }> {
  const messages: BaseMessage[] = [new HumanMessage(line)];
  let text = '';
  try {
    for await (const chunk of await model.stream(messages)) {
      text += typeof chunk.content === 'string' ? chunk.content : '';
    }
  } catch (error) {
    return { text, error: (error as Error).message };
  }
  return { text, error: null };
}

describe('the scripted model\'s mid-stream failure', () => {
  it('speaks the fragment and then throws, so the turn fails with text already on screen', async () => {
    const model = new ScriptedChatModel({ script, baseDir: '.' });

    const spoken = await speak(model, 'how many deals closed?');

    expect(spoken.text).toBe('Four deals closed last month, worth');
    expect(spoken.error).toBe('model connection reset');
  });

  it('leaves a turn with no failure scripted alone', async () => {
    const model = new ScriptedChatModel({ script, baseDir: '.' });

    const spoken = await speak(model, 'who owns northwind?');

    expect(spoken.text).toBe('Pat owns it.');
    expect(spoken.error).toBeNull();
  });
});
