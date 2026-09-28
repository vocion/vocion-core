/**
 * ask.file — an agent puts one question in front of a person.
 *
 * Until this an ask could only be filed over `POST /api/v1/asks`: a service
 * or an outside worker could ask, an agent running inside the app could not.
 * The product manager could rank a backlog and had no way to recommend the
 * top of it; a check that hit a decision it did not own could only write
 * "needs a person" in its report and hope someone read it.
 *
 * Filing goes through the action rail like every other write, and that is
 * the point rather than a formality. The trust ladder decides whether the
 * question reaches Needs you at once or a person first sees "this agent wants
 * to ask you something" — a workspace that finds an agent asking too much
 * parks `ask.file` at approval in `trust.yaml`, and one that trusts it leaves
 * the default. The default is done for you: an ask is `low` risk (a wrong one
 * costs a person a minute) and reversible (`undo` withdraws it while it is
 * still open), so a confident filing lands on the queue immediately with Undo
 * one move away.
 *
 * What the filed ask carries that the API cannot know: the agent that asked
 * (`agentSlug`, from the proposing principal), the run that asked it
 * (`sourceRef: action_run:<id>`, which also makes a retried execution
 * idempotent), and the mission run or conversation it happened in, as the
 * ask's context link. `objectRefs` names the records the question is about,
 * and rides `ask.decided` so the answer can be written back onto them.
 */

import type { Action, ActionContext, ReviewCard } from './types';
import { z } from 'zod';
// From the schema leaf, not the service: the registry loads this module, and
// the service's import graph reaches back into the registry (`policyKey`).
import { ASK_KINDS, ASK_RISKS } from '@/models/Schema';

/** One record the ask is about. `id` is kept as a string; a number is accepted and stringified. */
const objectRef = z.object({
  /** An object type slug — `request`, `deal`. */
  type: z.string().min(1).max(100),
  id: z.union([z.string().min(1).max(200), z.number().int()]).transform(String),
});

const option = z.union([
  z.string().min(1).max(200),
  z.object({
    id: z.string().min(1).max(80).optional(),
    label: z.string().min(1).max(200),
    /** The consequence of picking it, one line. */
    description: z.string().max(400).optional(),
    recommended: z.boolean().optional(),
    /** How sure the asker is of THIS option, 0–1. Meant for the recommended one. */
    confidence: z.number().min(0).max(1).optional(),
  }),
]);

const askFileInput = z.object({
  /** The question, as a person would ask it aloud. */
  title: z.string().min(1).max(200),
  /** Two to four lines: why, and what happens on each answer. Markdown. */
  body: z.string().max(4_000).optional(),
  /** What sort of thing is waiting. `approval` when unsaid: approve, reject or mark done. */
  kind: z.enum(ASK_KINDS).default('approval'),
  /** Named answers. Bare strings get `id = slug(label)`. At most one `recommended`. */
  options: z.array(option).max(8).optional(),
  risk: z.enum(ASK_RISKS).optional(),
  /** Several asks under one key are decided as one sheet. */
  groupKey: z.string().min(1).max(200).optional(),
  groupTitle: z.string().min(1).max(200).optional(),
  /** The mission this question serves. Recorded on the ask's context link when no `contextUrl` is given. */
  missionSlug: z.string().min(1).max(120).optional(),
  /** The records the question is about. */
  objectRefs: z.array(objectRef).max(20).optional(),
  /** Minutes of a person's attention the decision is estimated to take. */
  decisionCost: z.number().int().min(0).max(100_000).optional(),
  /**
   * The long form — the record, the PR, the run. An absolute http(s) URL or
   * an app path (`/dashboard/inbox/110`), the same form this action writes
   * itself when it links a mission. `.url()` alone refused the app path, and
   * on 2026-09-25 every card of a PM turn was refused for it (walk 20).
   */
  contextUrl: z.string().trim().max(2_000).refine(
    v => /^\/(?!\/)/.test(v) || /^https?:\/\/\S+$/i.test(v),
    'an https URL, or an app path starting with /',
  ).optional(),
  /** Optional collapsed Details, markdown. */
  contextMd: z.string().max(20_000).optional(),
  /** The caller's idempotency key. Re-filing it updates the open ask instead of doubling it. Absent, the action run's id is used. */
  sourceRef: z.string().min(1).max(200).optional(),
  dueAt: z.string().datetime().optional(),
  /**
   * Who is asking, when the proposer is not itself an agent (a token filing
   * on an agent's behalf). An agent principal's own slug wins over this.
   */
  agentSlug: z.string().min(1).max(120).optional(),
  teamSlug: z.string().min(1).max(120).optional(),
  /** Where the question came up — stamped by the tool, never by the model. */
  origin: z.object({
    missionRunId: z.number().int().positive().optional(),
    conversationId: z.number().int().positive().optional(),
  }).optional(),
});

export type AskFileInput = z.infer<typeof askFileInput>;

/**
 * `agent:<slug>` → `<slug>`, else undefined.
 * @param invokedBy
 */
function agentSlugFromInvoker(invokedBy: string | undefined): string | undefined {
  return invokedBy?.startsWith('agent:') ? invokedBy.slice(6) : undefined;
}

/**
 * The ask's context link when the caller gave none: the mission run the
 * question came up in, else the mission, else nothing. A person opening the
 * ask can then reach the work that raised it in one move.
 * @param input
 */
function defaultContextUrl(input: AskFileInput): string | undefined {
  if (input.contextUrl) {
    return input.contextUrl;
  }
  if (input.missionSlug && input.origin?.missionRunId) {
    return `/dashboard/missions/${input.missionSlug}/${input.origin.missionRunId}`;
  }
  if (input.missionSlug) {
    return `/dashboard/missions/${input.missionSlug}`;
  }
  return undefined;
}

function describeOptions(options: AskFileInput['options']): string | undefined {
  if (!options || options.length === 0) {
    return undefined;
  }
  return options
    .map(o => (typeof o === 'string' ? o : `${o.label}${o.recommended ? ' (recommended)' : ''}`))
    .join(' · ');
}

function describeRefs(refs: AskFileInput['objectRefs']): string | undefined {
  if (!refs || refs.length === 0) {
    return undefined;
  }
  return refs.map(r => `${r.type} ${r.id}`).join(', ');
}

export const askFileAction: Action<typeof askFileInput> = {
  id: 'ask.file',
  name: 'Ask a person',
  description: 'Put one question in front of a person on Needs you — a ruling, an approval, a recommendation, an input. Nothing executes when it is answered; the answer is the outcome, read back by whoever asked. Reversible: the ask is withdrawn with one Undo while it is still open.',
  inputSchema: askFileInput,
  grant: 'file_ask',
  // The question stays inside the workspace; nothing leaves the building.
  external: false,
  // A caller with an idempotency key of its own collapses onto it; a plain
  // question stands as its own card. Never a constant: two unrelated
  // questions must never become one queue item.
  dedupKeyFor: input => (input.sourceRef ? `ask.file:${input.sourceRef.trim().toLowerCase()}` : undefined),
  // The option shape the input schema cannot check — duplicate ids, two
  // recommended — is what the service refuses, and the refusal should leave
  // no queue item behind.
  async precheck(_ctx, input) {
    const { AskError, normaliseOptions } = await import('@/services/AskService');
    try {
      normaliseOptions(input.options);
    } catch (error) {
      if (error instanceof AskError) {
        return error.message;
      }
      throw error;
    }
    return undefined;
  },
  async reviewCard(_ctx, input): Promise<ReviewCard> {
    const fields: ReviewCard['fields'] = [{ label: 'Kind', value: input.kind }];
    const options = describeOptions(input.options);
    if (options) {
      fields.push({ label: 'Options', value: options });
    }
    if (input.risk) {
      fields.push({ label: 'Risk', value: input.risk });
    }
    if (input.decisionCost !== undefined) {
      fields.push({ label: 'Decision cost', value: `${input.decisionCost} min` });
    }
    const about = describeRefs(input.objectRefs);
    if (about) {
      fields.push({ label: 'About', value: about });
    }
    if (input.groupKey) {
      fields.push({ label: 'Decision sheet', value: input.groupTitle ?? input.groupKey });
    }
    const contextUrl = defaultContextUrl(input);
    return {
      title: `Ask: ${input.title}`,
      system: 'Ask',
      summary: input.body,
      fields,
      ...(contextUrl ? { links: [{ label: 'Where it came up', href: contextUrl }] } : {}),
      nextAction: 'Approving puts the question on Needs you for a person to answer. Nothing else runs; Undo withdraws it while it is still open.',
      verbs: { approve: 'Ask', reject: 'Do not ask' },
    };
  },
  async execute(ctx: ActionContext, input) {
    const { askUrlFor, normaliseOptions, upsertAsk } = await import('@/services/AskService');
    const { projectSlugById } = await import('@/services/ProjectService');
    const agentSlug = agentSlugFromInvoker(ctx.invokedBy) ?? input.agentSlug ?? null;
    // The run that asked is the idempotency key, so a retried execution
    // updates the ask it already filed instead of asking twice.
    const sourceRef = input.sourceRef?.trim() || (ctx.runId ? `action_run:${ctx.runId}` : null);
    const { ask, created } = await upsertAsk({
      orgId: ctx.orgId,
      createdBy: ctx.invokedBy ?? null,
      ask: {
        kind: input.kind,
        title: input.title,
        body: input.body,
        sourceRef,
        agentSlug,
        teamSlug: input.teamSlug,
        risk: input.risk,
        options: normaliseOptions(input.options),
        objectRefs: input.objectRefs ?? [],
        decisionCost: input.decisionCost,
        groupKey: input.groupKey,
        groupTitle: input.groupTitle,
        contextUrl: defaultContextUrl(input),
        contextMd: input.contextMd,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      },
    });
    const slug = await projectSlugById(ctx.orgId);
    return {
      askId: ask.id,
      url: slug ? askUrlFor(slug, ask.id) : null,
      created,
      kind: ask.kind,
      status: ask.status,
      agentSlug,
      sourceRef,
      groupKey: ask.groupKey,
      objectRefs: ask.objectRefs,
      missionSlug: input.missionSlug ?? null,
      origin: input.origin ?? null,
      filedAt: new Date().toISOString(),
    };
  },
  // Reversible: the question is withdrawn. An ask a person has already
  // answered is left exactly as it is — the answer may already have been
  // acted on — and the undo says so instead of pretending.
  async undo(ctx, _input, result) {
    const askId = typeof result.askId === 'number' ? result.askId : null;
    if (askId === null) {
      throw new Error('This run recorded no ask id, so there is nothing to withdraw.');
    }
    if (result.created === false) {
      return { askId, withdrawn: false, reason: 'this run refreshed an ask another filing created; withdraw that one instead' };
    }
    const { supersedeAsk } = await import('@/services/AskService');
    const ask = await supersedeAsk(ctx.orgId, askId, `Withdrawn: the filing was undone by ${ctx.reviewedBy ?? 'a person'}.`);
    return { askId, withdrawn: ask.status === 'superseded', status: ask.status };
  },
};
