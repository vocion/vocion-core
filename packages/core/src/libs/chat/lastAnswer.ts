import { normalizeAnswerHtml } from '@/libs/chat/answerText';

/**
 * The answer a surface with no trace posts: the turn's words after its last tool call. The words
 * before it ("I'll check the rollup first") are steps, which the app shows on the trace and Slack
 * cannot. Nothing is rewritten: it is the same text, cut where the last tool ran. A turn that said
 * nothing after its last tool, or whose answer was rebuilt past that point, keeps the whole response.
 * @param response - The turn's whole answer.
 * @param beforeLastTool - The raw words streamed before the last tool call.
 */
export function lastAnswerOf(response: string, beforeLastTool: string): string {
  const steps = normalizeAnswerHtml(beforeLastTool).trim();
  if (!steps || !response.startsWith(steps)) {
    return response;
  }
  const rest = response.slice(steps.length).trim();
  return rest || response;
}
