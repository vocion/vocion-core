/**
 * Why a model stopped writing a message — `tool_use`, `end_turn`,
 * `max_tokens` — read off a finished LangChain message, whichever provider
 * wrote it: Anthropic's `stop_reason` (on `response_metadata`, or on
 * `additional_kwargs` when the message was streamed), else OpenAI's
 * `finish_reason`. Undefined when the message does not say.
 *
 * One reader for the two places that record it: the generation in the trace
 * (`libs/Langfuse.ts`) and a broken tool call's row (`toolCallRecord.ts`).
 * Until 2026-09-28 neither kept it, and a propose_action call that stopped
 * mid-payload (conversation 349) could be read for its tokens, not its reason.
 * @param message - The message, as LangChain returns it.
 */
export function stopReasonOfMessage(message: unknown): string | undefined {
  const m = message as { response_metadata?: Record<string, unknown>; additional_kwargs?: Record<string, unknown> } | null | undefined;
  const reason = m?.response_metadata?.stop_reason ?? m?.additional_kwargs?.stop_reason ?? m?.response_metadata?.finish_reason;
  return typeof reason === 'string' ? reason : undefined;
}
