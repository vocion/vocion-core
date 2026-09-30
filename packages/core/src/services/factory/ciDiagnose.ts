/**
 * `ci.diagnose` — WHY A FACTORY PULL REQUEST'S CI IS RED, read by a model
 * (backlog 049). Chris, 2026-09-30, after PR #140's red CI sat seven hours:
 * "make Vocion fix it … the system should have sent the loop back to
 * engineering." Sending every red CI back to the engineer is right only when
 * the change broke it; a flaky test wants a re-run, a red default branch
 * wants one fix on that branch for every pull request behind it, and a broken
 * runner wants the pipeline's owner. Which one it is, is a question about
 * meaning — a log says it in words — so it is asked of the classifier once,
 * bound to one tool whose schema is the typed answer (the `turnJudge.ts`
 * shape), and `ciFailed` routes on the field. Never a regex over the log.
 *
 * The evidence is GitHub's: the failing checks with their annotations and
 * log tails (`githubChecks.readCheckLogs`), the files the pull request
 * changes, and whether the same checks are red on the branch it targets.
 *
 * A read that fails returns null and the caller does what it did before this
 * existed — back to the engineer — and says the diagnosis could not be made.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CheckLogs } from './githubChecks';
import { z } from 'zod';

export const CI_CAUSES = ['change_broke_it', 'flaky', 'main_broken', 'infra'] as const;
export type CiCause = typeof CI_CAUSES[number];

/** Where a red CI's fix lives: the product's code (the engineer's) or the pipeline (its owner's). */
export const CI_FIX_PLACES = ['code', 'pipeline'] as const;
export type CiFixPlace = typeof CI_FIX_PLACES[number];

export const CiDiagnosisSchema = z.object({
  cause: z.enum(CI_CAUSES).describe([
    'change_broke_it: the pull request\'s own change makes a check fail (a test, type, lint or build error in or caused by the files it changes).',
    'flaky: a check failed for a reason unrelated to the change that a re-run would likely pass (a timing-dependent or order-dependent test, a network blip in a test, a known-intermittent failure).',
    'main_broken: the same failure is on the branch the pull request targets, or the failure is in code the change does not touch and the base itself is broken.',
    'infra: the pipeline itself could not run the checks (runner lost, out of disk or minutes, a service container or registry down, a missing secret or permission, a timeout before any test ran).',
  ].join(' ')),
  why: z.string().max(240).describe('One line a person reads on the feature page: what failed and why you chose this cause.'),
  failing: z.string().max(200).nullable().describe('The failing test, file or step, named as the evidence names it (e.g. "admin.test.ts > saves the role"); null when no single one is named.'),
  fixIn: z.enum(CI_FIX_PLACES).nullable().optional().describe([
    'Where the fix lives.',
    'code: the product\'s own source, tests or dependencies — an engineer\'s change.',
    'pipeline: the CI or deploy workflow files (.github/workflows), the runner or service-container setup, a check\'s own configuration, a secret or permission the pipeline reads — the release engineer\'s change.',
    'infra is always pipeline; change_broke_it and flaky are always code.',
  ].join(' ')),
});
export type CiDiagnosis = z.infer<typeof CiDiagnosisSchema>;

type Model = Pick<BaseChatModel, 'bindTools'>;

/** What the diagnosis reads. */
export type CiEvidence = {
  orgId: string;
  prUrl: string;
  title?: string | null;
  logs: CheckLogs;
  /** The same checks on the branch the pull request targets, when read. */
  base?: { branch: string; sha: string | null; failing: string[]; complete: boolean } | null;
  /** The worker's own run of the checks, when it reported one ("6 of 6 passed"). */
  workerChecks?: string | null;
};

/**
 * The evidence as one read, bounded so the model sees all of it.
 * @param e - The evidence.
 */
export function evidenceText(e: CiEvidence): string {
  const checks = e.logs.failing.map((f, i) => [
    `### ${i + 1}. ${f.name} — ${f.conclusion}${f.step ? ` (step: ${f.step})` : ''}`,
    f.annotations.length > 0 ? `Annotations:\n${f.annotations.map(a => `- ${a}`).join('\n')}` : '',
    f.summary ? `Summary: ${f.summary}` : '',
    f.logTail ? `Log tail:\n${f.logTail.slice(-(i === 0 ? 5_000 : 2_000))}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
  return [
    `Pull request: ${e.prUrl}${e.title ? ` — ${e.title}` : ''}`,
    `Repository ${e.logs.repo}, head ${e.logs.headSha.slice(0, 12)}, ${e.logs.failing.length} of ${e.logs.checkCount} checks failed.`,
    e.workerChecks ? `The engineer's own run of the checks before opening it: ${e.workerChecks}` : '',
    e.base
      ? `The branch it targets (${e.base.branch} @ ${e.base.sha?.slice(0, 12) ?? '?'}): ${e.base.failing.length > 0 ? `failing ${e.base.failing.join(', ')}` : e.base.complete ? 'every check passed' : 'checks still running or none'}.`
      : 'The branch it targets could not be read.',
    `Files the pull request changes (${e.logs.changedFiles.length}):\n${e.logs.changedFiles.slice(0, 80).join('\n') || '(unknown)'}`,
    `## Failing checks\n\n${checks || '(GitHub named no failing check)'}`,
  ].filter(Boolean).join('\n\n').slice(0, 24_000);
}

/**
 * Why CI is red on a factory pull request, as typed fields; null when the read failed.
 * @param e - The evidence.
 * @param model - Injected in tests.
 */
export async function diagnoseCi(e: CiEvidence, model?: Model): Promise<CiDiagnosis | null> {
  try {
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const m = model ?? await (async () => {
      const { buildChatModelForOrg } = await import('@/libs/llm');
      return buildChatModelForOrg('classifier', e.orgId, { temperature: 0, streaming: false, maxTokens: 400 }) as Promise<Model>;
    })();
    const report = tool(async () => 'recorded', { name: 'report_ci_cause', description: 'Report why this pull request\'s CI failed.', schema: CiDiagnosisSchema as never });
    const bound = m.bindTools!([report], { tool_choice: 'report_ci_cause' } as never);
    const res = await bound.invoke([
      new SystemMessage('You are a release engineer. You read why a pull request\'s CI failed, from GitHub\'s own evidence, and report the cause and where its fix lives as typed fields. Judge from the evidence, not from the names of the checks. When the evidence does not separate the change from the rest, choose change_broke_it. Answer only through the tool.'),
      new HumanMessage(evidenceText(e)),
    ]) as { tool_calls?: Array<{ name: string; args: unknown }> };
    if (!model) {
      const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
      const { FEATURES } = await import('@/libs/Langfuse/features');
      await chargeModelCall({ orgId: e.orgId, feature: FEATURES.CI_DIAGNOSE, role: 'classifier', response: res });
    }
    const call = (res.tool_calls ?? []).find(c => c.name === 'report_ci_cause');
    const parsed = call ? CiDiagnosisSchema.safeParse(call.args) : null;
    return parsed?.success ? parsed.data : null;
  } catch (err) {
    console.warn('ci diagnose: the read failed', { orgId: e.orgId, prUrl: e.prUrl, message: (err as Error).message });
    return null;
  }
}
