/**
 * Legwork routing (`effort.ts`): the turn's opening call keeps the agent's
 * thinking, calls that read tool results run with it off, and the decision is
 * read off the messages' shape — never their words.
 */
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { createLegworkThinkingMiddleware, legworkConfig, readsToolResults, stepThinkingDiffers } from './effort';

describe('legwork routing', () => {
  it('defaults to thinking off after the plan and teammates on the fast model', () => {
    expect(legworkConfig(undefined)).toEqual({ model: 'fast', thinking: 'off' });
    expect(legworkConfig({ legworkModel: 'main', legworkThinking: 'agent' })).toEqual({ model: 'main', thinking: 'agent' });
    expect(legworkConfig({ legworkModel: 'nonsense' })).toEqual({ model: 'fast', thinking: 'off' });
  });

  it('holds a thinking-off model only where it differs from the agent\'s own', () => {
    // Sonnet 5 and Opus 5 think unless told not to.
    expect(stepThinkingDiffers({ provider: 'anthropic', model: 'claude-sonnet-5' })).toBe(true);
    expect(stepThinkingDiffers({ provider: 'bedrock', model: 'global.anthropic.claude-opus-5' })).toBe(true);
    // Models that cannot turn it off, or already keep it out of tool calls.
    expect(stepThinkingDiffers({ provider: 'anthropic', model: 'claude-opus-5-5' })).toBe(false);
    expect(stepThinkingDiffers({ provider: 'anthropic', model: 'claude-sonnet-5-5' })).toBe(false);
    // A model that does not think by default, and another vendor.
    expect(stepThinkingDiffers({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' })).toBe(false);
    expect(stepThinkingDiffers({ provider: 'openai', model: 'gpt-4o' })).toBe(false);
  });

  it('reads the turn\'s shape: the opening call reads the person, later calls read tool results', () => {
    const asked = [new HumanMessage('What sales emails do I need to answer')];
    const looked = [...asked, new AIMessage({ content: '', tool_calls: [{ id: 't1', name: 'search_knowledge', args: { query: 'sales' } }] }), new ToolMessage({ content: '[1] **Pricing**', tool_call_id: 't1' })];

    expect(readsToolResults(asked)).toBe(false);
    expect(readsToolResults(looked)).toBe(true);
    expect(readsToolResults([])).toBe(false);
    // A past turn's tool calls end in its answer, so a new question is an opening call again.
    expect(readsToolResults([...looked, new AIMessage('Two threads.'), new HumanMessage('And the other one?')])).toBe(false);
  });

  it('swaps the model only on calls that read tool results', async () => {
    const main = { id: 'main' };
    const step = { id: 'step' };
    const used: string[] = [];
    const wrap = createLegworkThinkingMiddleware(step as never).wrapModelCall as unknown as (r: unknown, h: (r: { model: { id: string } }) => unknown) => Promise<unknown>;
    const handler = (r: { model: { id: string } }) => {
      used.push(r.model.id);
      return {};
    };
    await wrap({ model: main, messages: [new HumanMessage('hi')] }, handler);
    await wrap({ model: main, messages: [new HumanMessage('hi'), new AIMessage({ content: '', tool_calls: [{ id: 't1', name: 'x', args: {} }] }), new ToolMessage({ content: 'ok', tool_call_id: 't1' })] }, handler);

    expect(used).toEqual(['main', 'step']);
  });
});

describe('thinking returns for the synthesis', () => {
  it('counts the turn\'s tool rounds since the person spoke', async () => {
    const { toolRounds } = await import('./effort');
    const call = (id: string) => new AIMessage({ content: '', tool_calls: [{ id, name: 'search_knowledge', args: {} }] });
    const past = [new HumanMessage('earlier'), call('p1'), new ToolMessage({ content: 'x', tool_call_id: 'p1' }), new AIMessage('answer')];

    expect(toolRounds([...past, new HumanMessage('now')])).toBe(0);
    expect(toolRounds([...past, new HumanMessage('now'), call('a'), new ToolMessage({ content: 'x', tool_call_id: 'a' })])).toBe(1);
    expect(toolRounds([...past, new HumanMessage('now'), call('a'), new ToolMessage({ content: 'x', tool_call_id: 'a' }), call('b'), new ToolMessage({ content: 'y', tool_call_id: 'b' })])).toBe(2);
  });

  it('is due after the envelope\'s rounds, its soft target, its evidence budget or a ceiling — and stays due', async () => {
    const { EffortCeilings, envelopeFor } = await import('./effort');
    const t0 = 1_000_000;
    const standard = () => new EffortCeilings(envelopeFor('standard'), t0);

    expect(standard().synthesisDue({ sources: 3, rounds: 1 }, t0 + 5_000)).toBe(false);
    expect(standard().synthesisDue({ sources: 3, rounds: 2 }, t0 + 5_000)).toBe(true);
    expect(standard().synthesisDue({ sources: 12, rounds: 1 }, t0 + 5_000)).toBe(true);
    expect(standard().synthesisDue({ sources: 3, rounds: 1 }, t0 + 21_000)).toBe(true);

    const latched = standard();
    latched.synthesisDue({ sources: 3, rounds: 2 }, t0 + 5_000);

    expect(latched.synthesisDue({ sources: 0, rounds: 0 }, t0 + 5_000)).toBe(true);
  });

  it('keeps the agent\'s model on a call that reads tool results once the synthesis is due', async () => {
    const used: string[] = [];
    let due = false;
    const wrap = createLegworkThinkingMiddleware({ id: 'step' } as never, () => due).wrapModelCall as unknown as (r: unknown, h: (r: { model: { id: string } }) => unknown) => Promise<unknown>;
    const handler = (r: { model: { id: string } }) => {
      used.push(r.model.id);
      return {};
    };
    const reading = { model: { id: 'main' }, messages: [new HumanMessage('hi'), new AIMessage({ content: '', tool_calls: [{ id: 't1', name: 'x', args: {} }] }), new ToolMessage({ content: 'ok', tool_call_id: 't1' })] };
    await wrap(reading, handler);
    due = true;
    await wrap(reading, handler);

    expect(used).toEqual(['step', 'main']);
  });
});
