/**
 * What the opening hint ranker (`libs/chat/openingHints.ts`) is told about
 * this person and this workspace, read once when a chat page renders. Every
 * read is best-effort: one that fails leaves its candidate out, never the
 * page. No model call.
 *
 * Sources, all already in the database:
 * - setup: each enabled plugin's declared setup steps (`setupStateForOrg`);
 *   a connector step needs an admin, and an unconnected one keeps the app's
 *   agents from reading what they run on.
 * - connectors: credentials that are revoked, expired or missing
 *   (`credentialStatusForOrg`).
 * - attention: what waits on this person elsewhere (`waitingElsewhere`, the
 *   dock's own read).
 * - next: the person's morning brief or evening wrap, delivered in the last
 *   18 hours and not yet opened (`services/personal/rhythm`), else the
 *   latest briefing, when there is one this week (the urgency chip).
 * - the person: conversations started and messages sent here, and their hint
 *   dismissals, from the adoption events (`user_activity_event`) — so no new
 *   table holds any of it.
 */

import type { HintInput, HintType, OpeningHint } from '@/libs/chat/openingHints';
import { and, count, desc, eq, gte, inArray, like, lte } from 'drizzle-orm';
import { HINT_TYPES, openingHints } from '@/libs/chat/openingHints';
import { triedLine } from '@/libs/connect/connectionNeeded';
import { connectSystemsHref } from '@/libs/connect/systemsLink';
import { db } from '@/libs/DB';
import { getConnector } from '@/libs/sources/registry';
import { briefingSchema, conversationSchema, projectSchema, userActivityEventSchema } from '@/models/Schema';

const DAY = 24 * 60 * 60 * 1000;

/**
 * A connector's name as a person reads it.
 * @param slug
 */
function connectorName(slug: string): string {
  return getConnector(slug)?.name ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * The hints for this person's empty conversation in this workspace.
 * @param input - Who and where.
 * @param input.orgId - The workspace.
 * @param input.userId - The person.
 * @param input.isAdmin - They are an admin of the Org.
 * @param input.leadSpoken - What the lead is called in a sentence.
 * @param input.now - Now (tests).
 */
export async function loadOpeningHints(input: { orgId: string; userId: string; isAdmin: boolean; leadSpoken: string; now?: Date }): Promise<OpeningHint[]> {
  const now = input.now ?? new Date();
  const since30 = new Date(now.getTime() - 30 * DAY);

  const [project, setups, credentials, waiting, brief, activity, dismissals, started, rhythm, tried] = await Promise.all([
    db.select({ createdAt: projectSchema.createdAt }).from(projectSchema).where(eq(projectSchema.id, input.orgId)).limit(1).then(r => r[0] ?? null).catch(() => null),
    import('@/services/plugins/setupState').then(m => m.setupStateForOrg(input.orgId)).catch(() => []),
    import('@/services/SourceCredentialService').then(m => m.credentialStatusForOrg(input.orgId)).catch(() => null),
    import('@/services/decisions/DecisionService').then(m => m.waitingElsewhere(input.orgId, input.userId)).catch(() => []),
    db.select({ title: briefingSchema.title }).from(briefingSchema).where(and(eq(briefingSchema.orgId, input.orgId), gte(briefingSchema.createdAt, new Date(now.getTime() - 7 * DAY)))).orderBy(desc(briefingSchema.createdAt)).limit(1).then(r => r[0] ?? null).catch(() => null),
    db.select({ type: userActivityEventSchema.eventType, n: count() }).from(userActivityEventSchema).where(and(eq(userActivityEventSchema.orgId, input.orgId), eq(userActivityEventSchema.userId, input.userId), inArray(userActivityEventSchema.eventType, ['chat.conversation_created', 'chat.message_sent']))).groupBy(userActivityEventSchema.eventType).catch(() => []),
    db.select({ metadata: userActivityEventSchema.metadata, at: userActivityEventSchema.createdAt }).from(userActivityEventSchema).where(and(eq(userActivityEventSchema.orgId, input.orgId), eq(userActivityEventSchema.userId, input.userId), eq(userActivityEventSchema.eventType, 'chat.hint_dismissed'), gte(userActivityEventSchema.createdAt, since30))).catch(() => []),
    // Setups this person started in a conversation and left (their objectives).
    import('@/services/objectives/ObjectiveService').then(m => m.startedSetups(input.orgId, input.userId)).catch(() => new Map<string, number>()),
    // Their brief or wrap, written for them and still unopened: one message, no turn yet.
    db.select({ id: conversationSchema.id, scopeRef: conversationSchema.scopeRef })
      .from(conversationSchema)
      .where(and(eq(conversationSchema.orgId, input.orgId), eq(conversationSchema.createdBy, input.userId), like(conversationSchema.scopeRef, 'personal-rhythm:%'), gte(conversationSchema.createdAt, new Date(now.getTime() - 18 * 60 * 60 * 1000)), lte(conversationSchema.messageCount, 1)))
      .orderBy(desc(conversationSchema.createdAt))
      .limit(1)
      .then(r => r[0] ?? null)
      .catch(() => null),
    // What agents tried and failed this week for want of a connection.
    import('@/services/connect/triedAndFailed').then(m => m.triedAndFailed(input.orgId, now)).catch(() => new Map<string, { times: number }>()),
  ]);

  const countOf = (type: string) => Number(activity.find(a => a.type === type)?.n ?? 0);
  const hintInput: HintInput = {
    now,
    person: { isAdmin: input.isAdmin, sessions: countOf('chat.conversation_created'), messagesSent: countOf('chat.message_sent') },
    workspace: { createdAt: project?.createdAt ?? now, leadSpoken: input.leadSpoken },
    apps: setups.filter(s => !s.complete).map(s => ({
      slug: s.plugin,
      name: s.name,
      steps: s.steps.map(step => ({ label: step.label, done: step.done, adminOnly: step.kind === 'connector' })),
      blocksAgents: s.steps.some(step => step.kind === 'connector' && !step.done),
      href: connectSystemsHref({ app: s.plugin }),
      resume: started.has(s.plugin) ? { conversationId: started.get(s.plugin)! } : null,
    })),
    connectors: [
      ...Object.entries(credentials?.byConnectorSlug ?? {})
        .filter(([, status]) => status.broken !== null || !status.connected)
        .map(([slug, status]) => {
          const times = tried.get(slug)?.times ?? 0;
          return {
            slug,
            name: connectorName(slug),
            state: status.broken === 'expired' ? 'expired' as const : status.broken ? 'broken' as const : 'incomplete' as const,
            // The ranker's connector boost: failed calls that needed it this week.
            recentTouches: times,
            ...(times > 0 ? { touchNote: triedLine(times).replace(/^./, c => c.toLowerCase()) } : {}),
            href: connectSystemsHref({ named: [slug] }),
          };
        }),
      // Never connected at all, and agents keep needing it.
      ...[...tried.entries()]
        .filter(([slug]) => !credentials?.byConnectorSlug?.[slug] && getConnector(slug))
        .map(([slug, t]) => ({
          slug,
          name: connectorName(slug),
          state: 'needed' as const,
          recentTouches: t.times,
          touchNote: triedLine(t.times, connectorName(slug)),
          href: connectSystemsHref({ named: [slug] }),
        })),
    ],
    waiting: waiting.map(d => ({
      kind: d.kind === 'approval' || d.kind === 'signoff' ? 'approval' as const : d.kind === 'question' || d.kind === 'choice' || d.kind === 'setup' ? 'ask' as const : 'fyi' as const,
      ageHours: d.createdAt ? (now.getTime() - new Date(d.createdAt).getTime()) / (60 * 60 * 1000) : 0,
      blocksRun: d.kind === 'approval' || Boolean(d.deadline),
    })),
    next: rhythm
      ? {
          key: `rhythm:${rhythm.id}`,
          label: rhythm.scopeRef?.startsWith('personal-rhythm:wrap') ? 'Your evening wrap is ready' : 'Your morning brief is ready',
          prompt: '',
          href: `/dashboard/chat?conversation=${rhythm.id}`,
          reason: 'Written for you just now, from your calendar, mail and workspaces.',
          weight: 1.9,
        }
      : brief
        ? { key: 'briefing', label: 'What needs my attention today?', prompt: `Walk me through the latest briefing ("${brief.title}") — the headline, what's at risk, and the moves that matter most today.`, reason: 'A new briefing came in this week.' }
        : null,
    dismissed: dismissals.flatMap((d) => {
      const meta = d.metadata as { key?: unknown; type?: unknown } | null;
      return typeof meta?.key === 'string' && HINT_TYPES.includes(meta.type as HintType) ? [{ key: meta.key, type: meta.type as HintType, at: d.at }] : [];
    }),
  };
  return openingHints(hintInput);
}
