/**
 * Feedback said in a thread, turned into work a person can start.
 *
 * `docs/DESIGN-PRINCIPLES.md` §9: *a learning system should be able to prove that it
 * is learning*. Someone telling an agent "you should have had the thread
 * context here" has stated a requirement; the manifesto's test asks whether
 * the interaction taught the system anything. Left as a Slack message the
 * answer is no.
 *
 * So one piece of feedback lands in two places, and neither of them executes
 * anything:
 *
 *   1. A **`learning_candidate`** (`polarity: correct`) carrying the words and
 *      a link back to where they were said. That is the agent-behaviour half:
 *      a person adopts it into a rule, or rejects it with a reason.
 *   2. An **ask** of kind `recommendation` in the workspace's Needs-you inbox,
 *      when the workspace has a team that builds. That is the product half:
 *      Plan and start* / *Add to backlog* / *Decline*, answered by a human in
 *      Vocion where their identity is known.
 *
 * Approving *Plan and start* is what kicks the work off. Nothing is authorised
 * from Slack — decision 025 stands, and a Slack user id authorises nothing.
 */

import type { ThreadContext } from './pageContext';
import type { Ask } from '@/services/AskService';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { projectSchema, teamSchema } from '@/models/Schema';
import { upsertAsk } from '@/services/AskService';
import { createCandidate } from '@/services/LearningCandidateService';

/** The learning step feedback about the product's own behaviour attaches to. */
export const FEEDBACK_STEP = 'global';

/**
 * Body/context caps — an ask is answered from a phone, and `verbosityHints`
 * in the inbox asks for a title at 80 or under.
 */
const TITLE_MAX = 80;
const CONTEXT_MAX = 4000;

/**
 * Does this team build things? A recommendation to change the product belongs
 * with whoever can change it, and "who can change it" is written in the team's
 * own words — its name, description and standing goal.
 *
 * A vocabulary match rather than a flag, because no schema field says "this
 * team ships software" and inventing one would need every workspace to set it
 * before this works at all.
 * @param team - Name, description and goal.
 * @param team.slug
 * @param team.name
 * @param team.description
 * @param team.goal
 */
export function looksLikeBuildTeam(team: { slug?: string | null; name?: string | null; description?: string | null; goal?: string | null }): boolean {
  const hay = [team.slug, team.name, team.description, team.goal].filter(Boolean).join(' ').toLowerCase();
  return /\b(?:engineer|engineering|build|builds|building|develop|development|developer|product|platform|software|ship|shipping)\b/.test(hay);
}

export type BuildTeam = { slug: string; name: string };

/**
 * The workspace's building team, if it has one.
 * @param orgId - Tenant.
 */
export async function findBuildTeam(orgId: string): Promise<BuildTeam | null> {
  const rows = await db.select({ slug: teamSchema.slug, name: teamSchema.name, description: teamSchema.description, goal: teamSchema.goal })
    .from(teamSchema)
    .where(eq(teamSchema.orgId, orgId));
  const hit = rows.find(looksLikeBuildTeam);
  return hit ? { slug: hit.slug, name: hit.name } : null;
}

/**
 * A title from the feedback itself — the person's words, clipped, never a template.
 * @param text
 */
export function titleFromFeedback(text: string): string {
  const firstSentence = text.trim().split(/(?<=[.!?])\s/)[0] ?? text.trim();
  const clean = firstSentence.replace(/\s+/g, ' ').trim();
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1)}…` : clean || 'Feedback from a chat thread';
}

/**
 * The thread, written out verbatim for the ask's Details — what was said, by whom.
 * @param thread
 * @param feedback
 * @param author
 */
export function threadTranscript(thread: ThreadContext | undefined, feedback: string, author: string): string {
  const lines: string[] = [];
  if (thread) {
    lines.push(`**Channel:** ${thread.channelName ? `#${thread.channelName}` : thread.channelId}`);
    if (thread.parent) {
      lines.push(`**The post this replies to** (${thread.parentIsOurs ? 'ours' : thread.parent.author}):\n> ${thread.parent.text.replace(/\n/g, '\n> ')}`);
    }
    if (thread.announced) {
      lines.push(`**It was announcing:** ${thread.announced.label}${thread.announced.url ? ` — ${thread.announced.url}` : ''}`);
    }
    for (const reply of thread.replies ?? []) {
      lines.push(`**${reply.ours ? 'Vocion' : reply.author}:** ${reply.text}`);
    }
  }
  lines.push(`**${author}:** ${feedback}`);
  const out = lines.join('\n\n');
  return out.length > CONTEXT_MAX ? `${out.slice(0, CONTEXT_MAX)}…` : out;
}

export type FileFeedbackInput = {
  orgId: string;
  /** What the person said, verbatim. */
  feedback: string;
  /** Who said it — a resolved name where we have one, the platform id otherwise. */
  author: string;
  /** The thread it was said in. */
  thread?: ThreadContext;
  /** The link back to the message. */
  permalink?: string | null;
  /** The agent that was spoken to. */
  agentSlug?: string | null;
  /** Actor label for the record; never an authorising identity. */
  createdBy?: string | null;
};

export type FiledFeedback = {
  candidateId: number;
  ask: Ask | null;
  /** The team the recommendation went to, when one was found. */
  team: BuildTeam | null;
  /** Absolute link to the inbox item, ready to paste into a reply. */
  inboxUrl: string | null;
};

/**
 * File one piece of feedback: a proposed rule, and — where there is a team
 * that builds — a recommendation in that workspace's Needs-you inbox.
 *
 * Idempotent on the permalink: the same message filed twice updates the open
 * ask rather than filling the inbox with copies of one complaint.
 * @param input - The feedback and where it was said.
 */
export async function fileFeedback(input: FileFeedbackInput): Promise<FiledFeedback> {
  const feedback = input.feedback.trim();
  if (!feedback) {
    throw new Error('feedback text must not be empty');
  }
  const source = input.permalink ?? (input.thread ? `slack:${input.thread.channelId}` : null);

  const candidate = await createCandidate({
    orgId: input.orgId,
    projectId: input.orgId,
    stepName: FEEDBACK_STEP,
    // The person's words, not a paraphrase: a candidate a human edits should
    // start from what was actually said.
    ruleText: feedback,
    polarity: 'correct',
    sourceRef: source,
  });

  const team = await findBuildTeam(input.orgId);
  if (!team) {
    return { candidateId: candidate.id, ask: null, team: null, inboxUrl: null };
  }

  const [project] = await db.select({ slug: projectSchema.slug, name: projectSchema.name })
    .from(projectSchema)
    .where(and(eq(projectSchema.id, input.orgId)))
    .limit(1);

  const body = [
    `**${input.author}** said this in ${input.thread?.channelName ? `#${input.thread.channelName}` : 'a chat thread'}:`,
    `> ${feedback.replace(/\n/g, '\n> ')}`,
    source ? `[Open the thread](${source})` : '',
    `Approving **Plan and start** is what begins the work — nothing has run yet.`,
  ].filter(Boolean).join('\n\n');

  const { ask } = await upsertAsk({
    orgId: input.orgId,
    createdBy: input.createdBy ?? null,
    ask: {
      kind: 'recommendation',
      title: titleFromFeedback(feedback),
      body,
      // Same message, same ask: re-filing updates rather than doubles.
      sourceRef: source ? `feedback:${source}` : null,
      agentSlug: input.agentSlug ?? null,
      teamSlug: team.slug,
      risk: 'low',
      options: [
        { id: 'plan-and-start', label: 'Plan and start', description: `${team.name} plans this and begins the work.`, recommended: true },
        { id: 'add-to-backlog', label: 'Add to backlog', description: 'Keep it, do not start it now.' },
        { id: 'decline', label: 'Decline', description: 'We are not doing this. Say why, and the reason is kept.' },
      ],
      contextMd: threadTranscript(input.thread, feedback, input.author),
      ...(source ? { contextUrl: source } : {}),
      projectId: input.orgId,
    },
  });

  const inboxUrl = project ? workspaceUrl(project.slug, `/dashboard/inbox/${ask.id}`, { absolute: true }) : null;
  return { candidateId: candidate.id, ask, team, inboxUrl };
}
