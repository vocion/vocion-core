/**
 * Whether a model's finished message called tools: LangChain's `tool_calls`
 * (or the chunks they stream as), or an Anthropic `tool_use` content block.
 * @param output - The `on_chat_model_end` output.
 */
export function endedOnToolCall(output: unknown): boolean {
  const o = (output ?? {}) as { tool_calls?: unknown[]; tool_call_chunks?: unknown[]; content?: unknown };
  if ((o.tool_calls?.length ?? 0) > 0 || (o.tool_call_chunks?.length ?? 0) > 0) {
    return true;
  }
  return Array.isArray(o.content) && o.content.some(b => (b as { type?: string } | null)?.type === 'tool_use');
}
