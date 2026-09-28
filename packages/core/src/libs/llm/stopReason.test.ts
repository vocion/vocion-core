import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { stopReasonOfMessage } from './stopReason';

describe('stopReasonOfMessage', () => {
  it('reads Anthropic\'s stop reason off a message, streamed or not', () => {
    expect(stopReasonOfMessage(new AIMessage({ content: '', response_metadata: { stop_reason: 'max_tokens' } }))).toBe('max_tokens');

    // A streamed message carries it where the message_delta chunk put it.
    const streamed = new AIMessageChunk({ content: '' }).concat(new AIMessageChunk({ content: '', additional_kwargs: { stop_reason: 'tool_use', stop_sequence: null } }));

    expect(stopReasonOfMessage(streamed)).toBe('tool_use');
  });

  it('reads OpenAI\'s finish reason, and says nothing when the message does not', () => {
    expect(stopReasonOfMessage(new AIMessage({ content: '', response_metadata: { finish_reason: 'length' } }))).toBe('length');
    expect(stopReasonOfMessage(new AIMessage({ content: 'hi' }))).toBeUndefined();
    expect(stopReasonOfMessage(undefined)).toBeUndefined();
  });
});
