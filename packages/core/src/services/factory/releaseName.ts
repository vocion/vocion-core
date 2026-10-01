/**
 * A RELEASE IS CALLED BY A SHORT NAME (2026-10-01, release #280: its title
 * was the request's whole sentence, "On Stamp's document page, add a line
 * under the document title that says when it was last opened and by whom",
 * shown twice). The request's title is the asker's words and is never
 * edited; the release gets a name of its own instead, written ONCE when the
 * release is linked: a classifier reads what shipped and returns a typed
 * `{name}` of a few words ("Last-opened line on the document page"). A name
 * already on the release (a person's, or this one's) is never replaced.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';

type Model = Pick<BaseChatModel, 'bindTools'>;

/** The longest name a release carries. */
export const RELEASE_NAME_MAX = 60;

export const ReleaseNameSchema = z.object({
  name: z.string().min(2).max(RELEASE_NAME_MAX).describe(`What shipped, as a short name a person would call it: a noun phrase of 2 to 7 words, at most ${RELEASE_NAME_MAX} characters, no trailing full stop. "Last-opened line on the document page", "Page count beside the document title".`),
});

const SYSTEM = 'You name a software release by what shipped, the way a product team would call it in a list. Answer only through the tool.';

/**
 * A short name for what shipped, or null when the read failed.
 * @param input - What shipped.
 * @param input.orgId - The workspace.
 * @param input.features - Each shipped feature: its title and outcome.
 * @param model - Injected in tests.
 */
export async function nameRelease(input: { orgId: string; features: ReadonlyArray<{ title: string; outcome: string | null }> }, model?: Model): Promise<string | null> {
  if (input.features.length === 0) {
    return null;
  }
  try {
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const m = model ?? await (async () => {
      const { buildChatModelForOrg } = await import('@/libs/llm');
      return buildChatModelForOrg('classifier', input.orgId, { temperature: 0, streaming: false, maxTokens: 120 }) as Promise<Model>;
    })();
    const report = tool(async () => 'recorded', { name: 'name_release', description: 'Name the release.', schema: ReleaseNameSchema as never });
    const res = await m.bindTools!([report], { tool_choice: 'name_release' } as never).invoke([
      new SystemMessage(SYSTEM),
      new HumanMessage(input.features.map(f => `- ${f.title}${f.outcome ? ` — ${f.outcome}` : ''}`).join('\n').slice(0, 4_000)),
    ]) as { tool_calls?: Array<{ name: string; args: unknown }> };
    if (!model) {
      const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
      const { FEATURES } = await import('@/libs/Langfuse/features');
      await chargeModelCall({ orgId: input.orgId, feature: FEATURES.RELEASE_NAME, role: 'classifier', response: res as never }).catch(() => undefined);
    }
    const call = (res.tool_calls ?? []).find(c => c.name === 'name_release');
    const parsed = call ? ReleaseNameSchema.safeParse(call.args) : null;
    return parsed?.success ? parsed.data.name.trim() : null;
  } catch (err) {
    console.warn('release name: the read failed', { orgId: input.orgId, message: (err as Error).message });
    return null;
  }
}
