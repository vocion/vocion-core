/**
 * The judgement: which findings warrant a change, and which change. A small
 * model reads the findings — typed facts, never a person's raw thread — and
 * answers in typed fields through one forced tool call (`turnJudge.ts`'s
 * shape). Code then routes on those fields: the change must be one the finding
 * allows, the agent is the finding's own, a role must be one the catalog
 * offered, a budget must be a sane number. The model chooses and words; it
 * never decides what is evidence, and it can only ever propose.
 *
 * A read that fails, times out or answers out of shape is "no judgement", and
 * the review files each finding's `fallback` — the change code can state on
 * its own — instead. A judgement that keeps a finding (`none`) files nothing
 * for it, and the review says so.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Finding } from './findings';
import type { OrgChange } from '@/libs/actions/org-change';
import { z } from 'zod';
import { ORG_CHANGE_KINDS } from '@/libs/actions/org-change';
import { DEFAULT_HIRE_CENTS } from './findings';

const MAX_DAILY_CENTS = 100_000;

export const OrgJudgementSchema = z.object({
  decisions: z.array(z.object({
    finding: z.number().int().positive().describe('The NUMBER of the finding this decision is about.'),
    change: z.enum([...ORG_CHANGE_KINDS, 'none']).describe('The change to propose, one of the finding\'s allowed changes, or none to keep things as they are.'),
    rule_text: z.string().max(600).nullable().optional().describe('With adopt_rule: the standing rule, one imperative sentence that would have prevented the corrections or answered the questions. Null otherwise.'),
    catalog_slug: z.string().max(120).nullable().optional().describe('With hire_agent: the slug of one role the finding lists. Null otherwise.'),
    daily_cents: z.number().int().nullable().optional().describe('With set_budget or hire_agent: the daily cap in cents. Null otherwise.'),
    headline: z.string().max(200).describe('One sentence a person reads first: the change and its one-line reason.'),
    reason: z.string().max(1000).describe('Two or three sentences arguing for it from the facts given, no others.'),
    confidence: z.number().min(0).max(1).describe('How sure you are this change is right, 0 to 1.'),
  })),
});

export type OrgJudgement = z.infer<typeof OrgJudgementSchema>;

/** One change the review will file, with the words and confidence it is filed with. */
export type JudgedProposal = {
  finding: Finding;
  change: OrgChange;
  headline: string;
  reason: string;
  confidence: number;
  /** `model` when the judge chose it, `fallback` when code did because no judgement came back. */
  by: 'model' | 'fallback';
};

export type JudgeOutcome = {
  proposals: JudgedProposal[];
  /** Findings the judge read and chose to leave as they are. */
  kept: Array<{ finding: Finding; reason: string }>;
  /** Decisions dropped because they did not fit the finding they named. */
  invalid: Array<{ finding: Finding | null; why: string }>;
  judged: 'model' | 'fallback';
};

type Model = Pick<BaseChatModel, 'bindTools'>;

const SYSTEM = `You review an AI agent team the way a careful manager would once a week. You are given numbered FINDINGS the platform measured — facts only, already dated. For each finding decide whether it warrants one change to the team, and which.

The changes:
  retire_agent — make an agent inactive. Only when it is plainly unused, not when its work is seasonal or its purpose suggests it runs rarely on purpose.
  set_budget — change an agent's daily cap (daily_cents). Raise it when the cap stops work people accept; cut it when spend buys work people turn down.
  hire_agent — add one role from the roles the finding lists (catalog_slug), with a daily allowance (daily_cents).
  adopt_rule — adopt one standing rule (rule_text) that would have prevented the corrections or pre-answered the questions in the finding. Write it as a general, imperative instruction; never copy one case's specifics.
  none — keep things as they are.

Be conservative: every change you propose costs a person a decision. Choose only from the finding's allowed changes. Argue only from the facts given. Answer for every finding.`;

/**
 * The finding as the judge reads it.
 * @param f - The finding.
 * @param n - Its number.
 */
function describe(f: Finding, n: number): string {
  const lines = [
    `${n}. [${f.signal}] ${f.summary}`,
    ...f.facts.map(x => `   - ${x}`),
    `   allowed: ${[...f.allowed, 'none'].join(', ')}`,
  ];
  if (f.currentDailyCents !== undefined) {
    lines.push(`   current daily cap (cents): ${f.currentDailyCents ?? 'none'}`);
  }
  if (f.catalog && f.catalog.length > 0) {
    lines.push(`   roles: ${f.catalog.map(r => `${r.slug} (${r.name} — ${r.description.slice(0, 120)})`).join('; ')}`);
  }
  return lines.join('\n');
}

/**
 * Turn one typed decision into a change the finding allows, or say why not.
 * Pure — the whole of "code routes on typed fields" lives here.
 * @param f - The finding the decision names.
 * @param d - The decision.
 */
export function changeFromDecision(f: Finding, d: OrgJudgement['decisions'][number]): { change: OrgChange } | { invalid: string } | { keep: true } {
  if (d.change === 'none') {
    return { keep: true };
  }
  if (!f.allowed.includes(d.change)) {
    return { invalid: `${d.change} is not a change this finding allows (${f.allowed.join(', ')})` };
  }
  switch (d.change) {
    case 'retire_agent':
      return f.agentSlug ? { change: { kind: 'retire_agent', agentSlug: f.agentSlug } } : { invalid: 'no agent to retire' };
    case 'set_budget': {
      const cents = d.daily_cents ?? null;
      if (!f.agentSlug || cents === null || cents < 100 || cents > MAX_DAILY_CENTS) {
        return { invalid: `daily_cents ${cents} is not a cap between 100 and ${MAX_DAILY_CENTS}` };
      }
      if (f.currentDailyCents !== undefined && f.currentDailyCents !== null && cents === f.currentDailyCents) {
        return { keep: true };
      }
      return { change: { kind: 'set_budget', agentSlug: f.agentSlug, dailyCents: cents } };
    }
    case 'hire_agent': {
      const role = f.catalog?.find(r => r.slug === d.catalog_slug);
      if (!role) {
        return { invalid: `catalog_slug ${String(d.catalog_slug)} is not one of the roles offered` };
      }
      const cents = d.daily_cents ?? DEFAULT_HIRE_CENTS;
      if (cents < 100 || cents > MAX_DAILY_CENTS) {
        return { invalid: `daily_cents ${cents} is not an allowance between 100 and ${MAX_DAILY_CENTS}` };
      }
      return { change: { kind: 'hire_agent', catalogSlug: role.slug, dailyCents: cents } };
    }
    default: {
      const text = d.rule_text?.trim() ?? '';
      if (text.length < 8) {
        return { invalid: 'adopt_rule needs a rule_text' };
      }
      return { change: { kind: 'adopt_rule', ...(f.agentSlug ? { agentSlug: f.agentSlug } : {}), ruleText: text } };
    }
  }
}

/**
 * What the review files when no judgement came back: each finding's own fallback.
 * @param findings - The findings the judge was shown.
 */
export function fallbackOutcome(findings: readonly Finding[]): JudgeOutcome {
  return {
    proposals: findings
      .filter(f => f.fallback !== null)
      .map(f => ({ finding: f, change: f.fallback!.change, headline: f.fallback!.headline, reason: f.fallback!.reason, confidence: 0.6, by: 'fallback' as const })),
    kept: [],
    invalid: [],
    judged: 'fallback',
  };
}

/**
 * Judge the findings. Never throws: a failed read is the fallback outcome.
 * @param input - What the judge reads.
 * @param input.orgId - The workspace, for the org's own model key, the trace and the charge.
 * @param input.workspace - Its name and goal, so "unused" is read against what it is for.
 * @param input.workspace.name - The workspace's name.
 * @param input.workspace.goal - Its top-line goal, when stated.
 * @param input.findings - Strongest first.
 * @param injected - A model, for tests; the org's classifier otherwise.
 */
export async function judgeFindings(
  input: { orgId: string; workspace: { name: string; goal: string | null }; findings: readonly Finding[] },
  injected?: Model,
): Promise<JudgeOutcome> {
  if (input.findings.length === 0) {
    return { proposals: [], kept: [], invalid: [], judged: 'model' };
  }
  const human = [
    `Workspace: ${input.workspace.name}${input.workspace.goal ? ` — goal: ${input.workspace.goal}` : ''}`,
    'FINDINGS:',
    ...input.findings.map((f, i) => describe(f, i + 1)),
  ].join('\n');

  let judgement: OrgJudgement | null = null;
  let response: unknown = null;
  try {
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const model = injected ?? await classifier(input.orgId);
    const report = tool(async () => 'recorded', { name: 'report_org_review', description: 'Report the decision for every finding.', schema: OrgJudgementSchema as never });
    const bound = model.bindTools!([report], { tool_choice: 'report_org_review' } as never);
    response = await bound.invoke([new SystemMessage(SYSTEM), new HumanMessage(human)]);
    const call = ((response as { tool_calls?: Array<{ name: string; args: unknown }> }).tool_calls ?? []).find(c => c.name === 'report_org_review');
    const parsed = call ? OrgJudgementSchema.safeParse(call.args) : null;
    judgement = parsed?.success ? parsed.data : null;
  } catch (error) {
    console.error(`[orgReview] the judge could not read ${input.orgId}'s findings; filing the fallbacks`, error);
  }
  if (response && !injected) {
    const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
    const { FEATURES } = await import('@/libs/Langfuse/features');
    await chargeModelCall({ orgId: input.orgId, feature: FEATURES.ORG_REVIEW, role: 'classifier', response });
  }
  if (!judgement) {
    return fallbackOutcome(input.findings);
  }

  const out: JudgeOutcome = { proposals: [], kept: [], invalid: [], judged: 'model' };
  const seen = new Set<number>();
  for (const d of judgement.decisions) {
    const f = input.findings[d.finding - 1];
    if (!f) {
      out.invalid.push({ finding: null, why: `finding ${d.finding} was not one of the ${input.findings.length} given` });
      continue;
    }
    if (seen.has(d.finding)) {
      continue; // one decision per finding; the first stands
    }
    seen.add(d.finding);
    const routed = changeFromDecision(f, d);
    if ('keep' in routed) {
      out.kept.push({ finding: f, reason: d.reason.trim() || d.headline.trim() });
    } else if ('invalid' in routed) {
      out.invalid.push({ finding: f, why: routed.invalid });
    } else {
      out.proposals.push({
        finding: f,
        change: routed.change,
        headline: d.headline.trim() || f.summary,
        reason: d.reason.trim() || f.summary,
        confidence: Math.min(1, Math.max(0, d.confidence)),
        by: 'model',
      });
    }
  }
  return out;
}

async function classifier(orgId: string): Promise<Model> {
  const { buildChatModelForOrg } = await import('@/libs/llm');
  return buildChatModelForOrg('classifier', orgId, { temperature: 0, streaming: false, maxTokens: 2_000 }) as Promise<Model>;
}
