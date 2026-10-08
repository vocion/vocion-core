/**
 * FunctionDraftService — a person describes a function in their own words and
 * a model drafts the plan that stands it up.
 *
 * An app's blank start (`app.yaml` `blank:`) asks for a description plus the
 * same short interview a template asks. One model call drafts a
 * `FunctionPlan` — teams with a lead and specialists, each agent's role, goal
 * and prompt, missions with measures, automations, conservative trust bars,
 * budgets — as TYPED output: the answer must be one JSON object that
 * `FunctionPlanSchema` parses and `planProblems` passes. A first answer that
 * does not is sent back once with every problem named; a second that does not
 * fails, saying why. Nothing is read out of prose and nothing is created here:
 * the plan goes to a preview, and only the person's Create stands it up
 * (`apps.install`).
 *
 * The model is offered what already exists — the agent catalog, the plugins,
 * the app's templates, the registered actions — and told to reuse before it
 * writes (`planContext.ts`). The app's brief (a markdown file it ships) says
 * what drafting means for it; core names no function.
 *
 * Charged to the workspace (`chargeModelCall`, feature `app.draft`) and
 * refused, in words, while a hard budget cap the call would land on is spent
 * (`preflightCheck`). Injectable, so the drafting is tested without a model.
 */

import type { FunctionPlan } from '@/libs/workspace/functionPlan';
import type { AppTemplateManifest } from '@/libs/workspace/schemas';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { FEATURES } from '@/libs/Langfuse/features';
import { fromRepoRoot } from '@/libs/repo-root';
import { APPS_REL, loadApp } from '@/libs/workspace/apps';
import { answerInterview } from '@/libs/workspace/appTemplates';
import { FunctionPlanSchema, planProblems, renderedProblems, renderFunctionPlan } from '@/libs/workspace/functionPlan';
import { catalogReader, planContextFor, planMenu } from './planContext';

/** Why a draft did not happen. */
export type DraftErrorCode = 'unknown' | 'answers' | 'budget' | 'invalid' | 'model';

export class FunctionDraftError extends Error {
  readonly code: DraftErrorCode;
  readonly problems?: Record<string, string>;
  constructor(code: DraftErrorCode, message: string, problems?: Record<string, string>) {
    super(message);
    this.name = 'FunctionDraftError';
    this.code = code;
    this.problems = problems;
  }
}

export type DraftDeps = {
  /** May the workspace spend on this call? A reason when a hard cap is spent. */
  budget: () => Promise<string | null>;
  /** One model call: the raw answer. Charges it. */
  complete: (system: string, human: string) => Promise<string>;
};

/**
 * Read the model's answer: one JSON object, parsed by the schema. Returns the
 * plan, or the problems to send back.
 * @param raw - The model's output.
 * @param appId - The app, for what the plan may cite.
 */
export function readDraft(raw: string, appId: string): { plan: FunctionPlan } | { problems: string[] } {
  const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return { problems: ['the answer was not one JSON object'] };
  }
  let json: unknown;
  try {
    json = JSON.parse(stripped.slice(start, end + 1));
  } catch (error) {
    return { problems: [`the JSON did not parse: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const parsed = FunctionPlanSchema.safeParse(json);
  if (!parsed.success) {
    return { problems: parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  const problems = planProblems(parsed.data, planContextFor(appId));
  if (problems.length === 0) {
    // What the loader would refuse, refused now — with the loader's words for the retry.
    problems.push(...renderedProblems(renderFunctionPlan(parsed.data, { installer: { email: 'check@example.com' }, catalog: catalogReader() })));
  }
  return problems.length > 0 ? { problems } : { plan: parsed.data };
}

/**
 * The drafter's instruction: the app's brief, what exists to reuse, the rules
 * a plan is held to, and the one JSON shape to answer in.
 * @param input - What it drafts against.
 * @param input.appId - The app.
 * @param input.brief - The app's drafting brief, as markdown.
 */
export function draftSystem(input: { appId: string; brief: string | null }): string {
  const menu = planMenu(input.appId);
  const schema = JSON.stringify(z.toJSONSchema(FunctionPlanSchema, { io: 'input' }));
  return [
    'You draft the plan that stands a business function up in a workspace of agents: the teams, who leads and who specialises, what each seat owns and is graded on, the standing missions with their measures, the automations that keep them, the trust bars and the budgets. A person will preview and edit your plan before anything is created.',
    input.brief ? `WHAT THIS APP ASKS OF A PLAN:\n${input.brief.trim().slice(0, 6000)}` : '',
    `REUSE BEFORE YOU WRITE. A catalog role that fits is hired as itself — set source {"kind":"catalog","slug":<its slug>,"why":...} and keep its slug as the agent's slug. Write a new seat (source {"kind":"new","systemPrompt":...}) only where no role fits, and never give a new seat a catalog role's slug. Turn a plugin on (reuse.plugins) when it already runs part of the function, and cite the closest template (reuse.template) when one is close. Say why for each.\n\nTHE CATALOG:\n${menu.catalog}\n\nTHE PLUGINS:\n${menu.plugins}\n\nTHIS APP'S TEMPLATES:\n${menu.templates || '(none)'}`,
    `THE RULES:\n- One to three teams. Each has a lead and at least one specialist; the lead sits on the team it leads.\n- Every team is graded on one to four measures with a target and a baseline. Prefer readings Vocion keeps: "observed" or "human-confirmed" over a registered action, else "agent-reported" with a camelCase count key.\n- Each seat's daily budget is modest: 50 to 500 cents unless the description says otherwise.\n- Missions are standing responsibilities on a five-field cron schedule; automations wake an agent on a schedule or a typed event and, when they keep a mission, name it in checkMission.\n- Trust bars start conservative: rung observe, recommend, assist or execute-with-approval, autoApproveAbove at least 0.9, only for actions the seats actually take.\n- Slugs are lowercase letters, digits and hyphens. Measures and trust bars name only registered actions:\n${menu.actions}\n- Claim nothing the description does not support. Write prompts in plain words: what the seat owes, how it is judged, what it never does without a person.`,
    `Answer with ONE JSON object and nothing else, matching this JSON Schema:\n${schema}`,
  ].filter(Boolean).join('\n\n');
}

/**
 * Read the app's drafting brief from its directory.
 * @param appId - The app.
 * @param file - The brief's file name.
 */
function readBrief(appId: string, file: string): string | null {
  const abs = fromRepoRoot(join(APPS_REL, appId, file));
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/**
 * Draft a plan from a person's description. Never creates anything.
 * @param opts - The draft.
 * @param opts.orgId - The workspace the plan is for (and the budget it is charged to).
 * @param opts.appId - The app whose blank start this is.
 * @param opts.description - The function, in the person's own words.
 * @param opts.answers - The interview's answers.
 * @param opts.installer - The person — accountable for what the plan stands up.
 * @param opts.installer.email - Their email.
 * @param opts.installer.name - Their name.
 * @param opts.workspaceName - The workspace's name, for defaults.
 * @param deps - Override the side effects (tests); defaults to the real model and budget.
 */
export async function draftFunctionPlan(opts: {
  orgId: string;
  appId: string;
  description: string;
  answers: Readonly<Record<string, unknown>>;
  installer: { email: string; name: string };
  workspaceName: string;
}, deps: DraftDeps = realDraftDeps(opts.orgId)): Promise<{ plan: FunctionPlan; attempts: number }> {
  let app;
  try {
    app = loadApp(opts.appId);
  } catch (error) {
    throw new FunctionDraftError('unknown', error instanceof Error ? error.message : String(error));
  }
  if (!app.blank) {
    throw new FunctionDraftError('unknown', `app "${opts.appId}" has no blank start`);
  }
  const description = opts.description.replace(/\s+/g, ' ').trim();
  const problems: Record<string, string> = {};
  if (description.length < 20) {
    problems.description = 'say a little more — a sentence or two about what it does and for whom';
  } else if (description.length > app.blank.describe.maxLength) {
    problems.description = `keep it under ${app.blank.describe.maxLength} characters`;
  }
  // The same interview a template asks, answered the same way.
  const answered = answerInterview({ interview: app.blank.interview } as AppTemplateManifest, opts.answers, { installer: opts.installer, workspace: { name: opts.workspaceName } });
  if (!answered.ok) {
    Object.assign(problems, answered.problems);
  }
  if (Object.keys(problems).length > 0 || !answered.ok) {
    throw new FunctionDraftError('answers', Object.entries(problems).map(([k, v]) => `${k}: ${v}`).join('; '), problems);
  }
  const refused = await deps.budget();
  if (refused) {
    throw new FunctionDraftError('budget', refused);
  }

  const system = draftSystem({ appId: opts.appId, brief: readBrief(opts.appId, app.blank.brief) });
  const facts = app.blank.interview.map(q => `${q.question} ${answered.values[q.key]}`).join('\n');
  const human = `THE FUNCTION, IN THE PERSON'S WORDS:\n${description}\n\nTHEIR ANSWERS:\n${facts}\n\nThe person accountable is ${opts.installer.name || opts.installer.email}.`;
  let reply = await deps.complete(system, human).catch((error) => {
    throw new FunctionDraftError('model', `The draft could not be written: ${error instanceof Error ? error.message : String(error)}`);
  });
  let read = readDraft(reply, opts.appId);
  if ('plan' in read) {
    return { plan: read.plan, attempts: 1 };
  }
  // One corrective retry, carrying every problem by name.
  reply = await deps.complete(system, `${human}\n\nYOUR LAST ANSWER COULD NOT BE USED:\n${read.problems.map(p => `- ${p}`).join('\n')}\n\nAnswer again with one corrected JSON object.`).catch((error) => {
    throw new FunctionDraftError('model', `The draft could not be written: ${error instanceof Error ? error.message : String(error)}`);
  });
  read = readDraft(reply, opts.appId);
  if ('plan' in read) {
    return { plan: read.plan, attempts: 2 };
  }
  throw new FunctionDraftError('invalid', `The draft came back unusable twice, so nothing was proposed: ${read.problems.slice(0, 6).join('; ')}`);
}

/**
 * The real side effects: the budget's preflight, and one charged, traced
 * model call on the org's own key resolution.
 * @param orgId - The workspace.
 */
export function realDraftDeps(orgId: string): DraftDeps {
  return {
    budget: async () => {
      const { preflightCheck } = await import('@/services/BudgetService');
      const check = await preflightCheck({ orgId, feature: FEATURES.APP_DRAFT });
      return check.ok ? null : `This workspace's ${check.scope === 'org' ? 'spend' : `"${check.agentSlug}"`} budget is spent for the period, so no draft was written. Raise the cap on Budgets, or try again when the period turns.`;
    },
    complete: async (system, human) => {
      const [{ buildChatModelForOrg }, { HumanMessage, SystemMessage }, { traceFor, cleanUsageDetails }, { chargeModelCall }, { usageMetadataOf }] = await Promise.all([
        import('@/libs/llm/langchain'),
        import('@langchain/core/messages'),
        import('@/libs/Langfuse'),
        import('@/services/budget/chargeModelCall'),
        import('@/libs/llm/usage'),
      ]);
      const trace = traceFor({ feature: FEATURES.APP_DRAFT, slug: 'function-plan', orgId, userId: 'app-draft', input: { chars: human.length } });
      const generation = trace.generation({ name: 'draft', model: 'main', input: human });
      const model = await buildChatModelForOrg('main', orgId, { temperature: 0.2, streaming: false, maxTokens: 8000 });
      const res = await model.invoke([new SystemMessage(system), new HumanMessage(human)], { signal: AbortSignal.timeout(120_000) });
      const raw = typeof res.content === 'string' ? res.content : (res.content as Array<{ type?: string; text?: string }>).map(c => (c.type === 'text' ? c.text ?? '' : '')).join('');
      const usage = usageMetadataOf(res);
      generation.end({ output: raw, usageDetails: usage ? cleanUsageDetails({ input: usage.input_tokens, output: usage.output_tokens }) : undefined });
      await chargeModelCall({ orgId, feature: FEATURES.APP_DRAFT, role: 'main', response: res });
      return raw;
    },
  };
}
