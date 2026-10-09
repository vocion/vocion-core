/**
 * The personal brief — one noun, one composer, one budget
 * (docs/guides/morning-brief.md).
 *
 * A workspace brief says how one workspace is doing. A person in several wants
 * one page about their own day, and this file is the only place that writes
 * it. It comes in two kinds on the same composer:
 *
 * - **Your day** (`brief`, the morning): today's meetings with a line of
 *   context each from the person's own connections, what is waiting on them
 *   everywhere (the cross-workspace queue, their own rows first), what the
 *   team did since they last looked, and each workspace's latest brief by its
 *   headline.
 * - **Your wrap** (`wrap`, the evening): what got done today, what is still
 *   open, and what is first tomorrow.
 *
 * Every fact is rendered in code from a record, dated and linked (principle
 * 10); the one model call (`personalWriter.ts`) writes only the meeting
 * context lines and up to three suggested actions, and only when the brief
 * budget allows it (`budgetGate.ts`). Less evidence makes a shorter brief, not
 * a longer apology (`docs/design/reduction.md`).
 *
 * Stored as a briefing (principle 7: the noun is the brief) in the person's
 * personal workspace, the one place only they can open, so it lists on that
 * workspace's Briefings page with its history. One edition per person, kind
 * and local day (`briefing.edition`, `brief:2026-10-09`): asking again that
 * day, or the scheduled delivery running after someone asked, refreshes the
 * same row instead of adding one. The scheduled delivery
 * (`personalDelivery.ts`) publishes through {@link publishPersonalBrief} like
 * the Briefings page's own button does. One account at a time: a brief stored
 * in one account never carries another account's workspaces.
 */

import type { Meeting, PersonalFacts } from './personalFacts';
import type { BriefWriter, SuggestedAction, WriterOutput } from './personalWriter';
import type { RhythmKind } from '@/libs/personal/rhythm';
import type { CrossWorkspaceItem, InboxWorkspace } from '@/services/inbox/acrossWorkspaces';
import type { InboxItem } from '@/services/InboxService';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { dayKey, DEFAULT_TIME_ZONE, formatDate, formatDateTime, formatTime } from '@/libs/time/zone';
import { briefingSchema, personalRhythmSchema } from '@/models/Schema';
import { ensurePersonalProject } from '@/services/workspace/personalProject';
import { briefBudget } from './budgetGate';
import { briefingHref } from './links';
import { gatherPersonalFacts, withMeetingEvidence } from './personalFacts';
import { MAX_ACTIONS, modelWriter } from './personalWriter';
import { parseStoredDocument } from './store';
import { briefingTitle } from './title';

/** Who publishes a personal brief, either kind: the same `job:<name>` shape every scheduled publisher uses. */
export const PERSONAL_BRIEF_PUBLISHER = 'job:personal-brief';

/** How many waiting rows the brief names. The rest are a count and a link. */
export const PERSONAL_BRIEF_TOP = 5;

/** The two kinds of personal brief: the morning "your day" and the evening wrap. */
export type PersonalBriefKind = RhythmKind;

/** What each kind is called, as a title and in a sentence. */
const KIND_NAME: Record<PersonalBriefKind, string> = { brief: 'Your day', wrap: 'Your wrap' };

/**
 * The once-only key of one edition: one brief per person, kind and local day.
 * @param kind - Brief or wrap.
 * @param day - The person's local day, `YYYY-MM-DD`.
 */
export function personalEdition(kind: PersonalBriefKind, day: string): string {
  return `${kind}:${day}`;
}

/** One workspace's line in the brief. */
export type PersonalBriefWorkspace = {
  workspace: InboxWorkspace;
  /** Its latest brief, or null when it has none. */
  briefing: { id: number; title: string; headline: string; at: Date; href: string } | null;
  waiting: number;
  yours: number;
};

export type PersonalBrief = {
  kind: PersonalBriefKind;
  /** The person's local day it is for. */
  day: string;
  title: string;
  at: Date;
  /** Open decisions across the account's workspaces, and how many are the person's own. */
  waiting: { total: number; yours: number; top: CrossWorkspaceItem[] };
  workspaces: PersonalBriefWorkspace[];
  /** Workspaces that could not be read, said in the brief rather than dropped. */
  unavailable: Array<{ workspace: InboxWorkspace; reason: string }>;
  /** Up to {@link MAX_ACTIONS} things to do first; pills under the delivered message, never a card, never rendered twice. */
  actions: SuggestedAction[];
  /** One sentence: the brief's own summary, for the chat message and the push. */
  lead: string;
  markdown: string;
};

/**
 * What a brief leads with: its own one-sentence summary, else its title.
 * @param brief - A stored brief.
 * @param brief.title - Its title.
 * @param brief.document - Its typed document, if any.
 */
export function headlineOf(brief: { title: string; document: unknown }): string {
  const doc = parseStoredDocument(brief.document);
  return doc?.today?.summary?.trim() || brief.title;
}

/**
 * Each workspace's latest brief, in one query: the workspace rollup when there
 * is one, else its newest team brief. Personal briefs are never a workspace's
 * headline, or "your day" would quote yesterday's "your day".
 * @param workspaces - The workspaces.
 */
async function latestBriefs(workspaces: readonly Pick<InboxWorkspace, 'id'>[]): Promise<Map<string, { id: number; title: string; document: unknown; createdAt: Date }>> {
  if (workspaces.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectDistinctOn([briefingSchema.orgId], { orgId: briefingSchema.orgId, id: briefingSchema.id, title: briefingSchema.title, document: briefingSchema.document, createdAt: briefingSchema.createdAt })
    .from(briefingSchema)
    .where(and(
      inArray(briefingSchema.orgId, workspaces.map(w => w.id)),
      sql`${briefingSchema.publishedBy} is distinct from ${PERSONAL_BRIEF_PUBLISHER}`,
    ))
    .orderBy(briefingSchema.orgId, sql`(${briefingSchema.teamSlug} is null) desc`, desc(briefingSchema.createdAt));
  return new Map(rows.map(r => [r.orgId, r]));
}

/** What the renderer is given. Everything past `timeZone` is optional so a brief with less says less. */
export type PersonalBriefParts = Pick<PersonalBrief, 'waiting' | 'workspaces' | 'unavailable'> & {
  timeZone: string;
  kind?: PersonalBriefKind;
  /** The live facts (meetings, the team, today's work). Absent: the queue and the workspaces only. */
  facts?: PersonalFacts;
  /** The writer's lines, or null when it was not asked or could not answer. */
  written?: WriterOutput | null;
  /** How many suggested actions are offered as pills under the delivered message. */
  actions?: number;
};

/**
 * The context line for a meeting with no written one: its first piece of
 * evidence, said with where it came from.
 * @param m - The meeting.
 */
function evidenceLine(m: Meeting): string {
  const e = m.evidence[0];
  return e ? `${e.text.split(' — ')[0]!.slice(0, 110)} (${e.where})` : '';
}

/**
 * The lead sentence of a brief: what the chat message and the push say.
 * @param p - The parts.
 */
function leadOf(p: PersonalBriefParts): string {
  const f = p.facts;
  const day = f ? formatDate(f.now, p.timeZone) : '';
  const yours = p.waiting.yours;
  const on = `${yours} ${yours === 1 ? 'decision' : 'decisions'} on you`;
  if (!f) {
    return p.waiting.total === 0 ? 'Nothing is waiting on you.' : `${on}, ${p.waiting.total} in all.`;
  }
  if (p.kind === 'wrap') {
    const done = f.doneToday.length + f.finishedToday.length;
    return `Your wrap — ${day}. ${done} done today, ${yours} still open on you.`;
  }
  const meetings = f.meetings.status === 'read' ? `${f.meetings.items.length} ${f.meetings.items.length === 1 ? 'meeting' : 'meetings'}` : 'calendar not read';
  return `Good morning${f.name ? `, ${f.name.split(' ')[0]}` : ''} — ${day}. ${meetings}, ${on}.`;
}

/**
 * The brief's words, either kind. Pure.
 * @param p - What it says.
 */
export function renderPersonalBrief(p: PersonalBriefParts): string {
  const { waiting, timeZone: tz, facts: f } = p;
  const kind = p.kind ?? 'brief';
  const out: string[] = [];
  const contextOf = new Map((p.written?.meetings ?? []).map(m => [m.id, m.context.trim()]));

  if (f) {
    out.push(`**${leadOf({ ...p, kind })}**`, '');
  }

  // Morning: today's meetings, with a line of context each.
  if (f && kind === 'brief') {
    out.push('## Today\'s meetings', '');
    if (f.meetings.status === 'unavailable') {
      out.push(f.meetings.why);
    } else if (f.meetings.items.length === 0) {
      out.push('Nothing on your calendar today.');
    } else {
      for (const m of f.meetings.items) {
        const when = m.allDay ? 'All day' : m.start ? formatTime(m.start, tz) : '';
        const context = contextOf.get(m.id) || evidenceLine(m);
        out.push(`- **${when} · ${m.title}**${context ? ` — ${context}` : ''}`);
      }
    }
    out.push('');
  }

  // Evening: what got done.
  if (f && kind === 'wrap') {
    out.push('## Done today', '');
    if (f.doneToday.length === 0 && f.finishedToday.length === 0) {
      out.push('Nothing decided or finished on the record today.');
    }
    for (const d of f.doneToday) {
      out.push(`- You decided [${d.title}](${d.href}) — ${d.workspace}`);
    }
    for (const r of f.finishedToday) {
      out.push(`- Finished: ${r.title} — ${r.workspace}`);
    }
    out.push('');
  }

  // Both: what is waiting, in the order to take it.
  const followUps = f?.waiting.followUps ?? [];
  if (waiting.total === 0 && followUps.length === 0) {
    out.push(f ? `## ${kind === 'wrap' ? 'Still open' : 'Waiting on you'}\n\nNothing is waiting on you.` : 'Nothing is waiting on you.');
  } else {
    out.push(`## ${kind === 'wrap' ? 'Still open' : 'Waiting on you'}`, '');
    if (waiting.total > 0) {
      const places = new Set(waiting.top.map(i => i.workspace.id)).size;
      const where = p.workspaces.filter(w => w.waiting > 0).length || places;
      out.push(`${waiting.yours > 0 ? `${waiting.yours} ${waiting.yours === 1 ? 'is' : 'are'} yours, ` : ''}${waiting.total} ${waiting.total === 1 ? 'decision' : 'decisions'} in all, across ${where} ${where === 1 ? 'workspace' : 'workspaces'}.`, '');
      for (const item of waiting.top) {
        out.push(`- [${item.title}](${item.link}) — ${item.workspace.name}${item.yours ? ', yours' : ''}, waiting since ${formatDate(item.at, tz)}`);
      }
      const rest = waiting.total - waiting.top.length;
      if (rest > 0) {
        out.push(`- and ${rest} more in the review queue`);
      }
    }
    for (const u of followUps.slice(0, 3)) {
      out.push(`- Follow-up you owe: [${u.title}](${u.href}) — ${u.workspace.name}`);
    }
  }
  // The person's saved views for the brief, each a short list with its count.
  for (const v of (f?.waiting.views ?? []).filter(x => x.total > 0)) {
    out.push('', `### ${v.name} (${v.total})`, '');
    for (const r of v.rows.slice(0, 5)) {
      out.push(`- ${r.link ? `[${r.title}](${r.link})` : r.title}${r.at ? ` — ${formatDate(r.at, tz)}` : ''}`);
    }
    if (v.total > v.rows.length) {
      out.push(`- and ${v.total - Math.min(v.rows.length, 5)} more`);
    }
  }

  // Morning: what the team did since the person last looked.
  if (f && kind === 'brief' && f.team.length > 0) {
    out.push('', `## Since you last looked (${formatDateTime(f.since, tz)})`, '');
    for (const t of f.team) {
      const parts = [
        t.decided > 0 ? `${t.decided} ${t.decided === 1 ? 'decision' : 'decisions'} taken` : '',
        ...t.runs.map(r => `finished “${r}”`),
        ...t.briefs.map(b => `[${b.title}](${b.href})`),
      ].filter(Boolean);
      out.push(`- **${t.workspace.name}** — ${parts.join(', ')}`);
    }
  }

  // Morning: each workspace by its own latest brief.
  const lines = kind === 'brief' ? p.workspaces.filter(w => w.briefing || w.waiting > 0) : [];
  if (lines.length > 0) {
    out.push('', '## Your workspaces', '');
    for (const w of lines) {
      const brief = w.briefing
        ? `“${w.briefing.headline}” ([brief of ${formatDate(w.briefing.at, tz)}](${w.briefing.href}))`
        : 'no brief yet';
      out.push(`- **${w.workspace.name}** — ${brief}${w.waiting > 0 ? ` · ${w.waiting} waiting` : ''}`);
    }
  }

  // Evening: what is first tomorrow.
  if (f && kind === 'wrap') {
    out.push('', '## First tomorrow', '');
    const first = f.meetings.status === 'read' ? f.meetings.items.find(m => !m.allDay) : undefined;
    if (first?.start) {
      out.push(`- **${formatTime(first.start, tz)} · ${first.title}**`);
    } else if (f.meetings.status === 'unavailable') {
      out.push(`- ${f.meetings.why}`);
    }
    const oldest = waiting.top.find(i => i.yours);
    if (oldest) {
      out.push(`- Take [${oldest.title}](${oldest.link}) first — it has waited longest.`);
    } else if (!first) {
      out.push('- Nothing is booked or waiting yet.');
    }
  }

  const unavailable = p.unavailable.length > 0 ? p.unavailable : [];
  if (unavailable.length > 0) {
    out.push('', `Could not read ${unavailable.map(u => `${u.workspace.name} (${u.reason})`).join(', ')}; what is above leaves them out.`);
  }
  if (p.actions && p.actions > 0) {
    out.push('', p.actions === 1 ? 'One thing to start on is offered under your brief in chat.' : `The ${p.actions} things to start on are offered under your brief in chat.`);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * When the person last looked: their last brief or wrap, else a day ago.
 * @param userId - The person.
 * @param accountId - Their Org.
 * @param now - The clock.
 */
async function lastLookedAt(userId: string, accountId: string, now: Date): Promise<Date> {
  const [row] = await db
    .select({ lastBriefAt: personalRhythmSchema.lastBriefAt, lastWrapAt: personalRhythmSchema.lastWrapAt })
    .from(personalRhythmSchema)
    .where(and(eq(personalRhythmSchema.userId, userId), eq(personalRhythmSchema.accountId, accountId)))
    .limit(1);
  const last = [row?.lastBriefAt, row?.lastWrapAt].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
  return last ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

/** Options every compose and publish takes. */
export type PersonalBriefOptions = {
  kind?: PersonalBriefKind;
  /** The person's local day it is for; defaults to today in `timeZone`. */
  day?: string;
  now?: Date;
  timeZone?: string;
  /** One workspace's open rows (a seam for tests). */
  read?: (orgId: string) => Promise<InboxItem[]>;
  /** Facts already gathered (the delivery's empty-day check reads them first). */
  facts?: PersonalFacts;
  /** The model seam; null composes from the facts alone, with no model call. */
  writer?: BriefWriter | null;
};

/**
 * Gather the facts the composer needs.
 * @param userId - The person.
 * @param accountId - The account.
 * @param personalOrgId - Their personal workspace.
 * @param opts - As {@link PersonalBriefOptions}.
 */
export async function personalBriefFacts(userId: string, accountId: string, personalOrgId: string, opts: PersonalBriefOptions = {}): Promise<PersonalFacts> {
  const now = opts.now ?? new Date();
  return gatherPersonalFacts({
    kind: opts.kind ?? 'brief',
    userId,
    accountId,
    personalOrgId,
    timeZone: opts.timeZone ?? DEFAULT_TIME_ZONE,
    since: await lastLookedAt(userId, accountId, now),
    now,
    ...(opts.read ? { read: opts.read } : {}),
  });
}

/**
 * Compose the person's brief for one account. Reads only (and the one model
 * call when a writer is given).
 * @param userId - The person.
 * @param accountId - The account.
 * @param opts - As {@link PersonalBriefOptions}; with no writer given, none is called.
 */
export async function composePersonalBrief(userId: string, accountId: string, opts: PersonalBriefOptions = {}): Promise<PersonalBrief> {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;
  const kind = opts.kind ?? 'brief';
  const personalOrgId = opts.facts?.personalOrgId ?? (await ensurePersonalProject(userId, accountId)).id;
  let facts = opts.facts ?? await personalBriefFacts(userId, accountId, personalOrgId, { ...opts, now, timeZone, kind });
  if (kind === 'brief') {
    facts = await withMeetingEvidence(facts);
  }
  const written = opts.writer
    ? await opts.writer(personalOrgId, (await import('./personalWriter')).factsForWriter(facts))
    : null;

  const inbox = facts.inbox;
  const briefs = await latestBriefs(inbox.workspaces);
  const workspaces: PersonalBriefWorkspace[] = inbox.workspaces.map((w) => {
    const b = briefs.get(w.id);
    return {
      workspace: { id: w.id, slug: w.slug, name: w.name, kind: w.kind },
      briefing: b
        ? { id: b.id, title: b.title, headline: headlineOf(b), at: b.createdAt, href: workspaceUrl(w.slug, briefingHref(b.id), w.accountSlug ? { accountSlug: w.accountSlug } : {}) }
        : null,
      waiting: w.count,
      yours: w.yours,
    };
  });
  const waiting = { total: inbox.total, yours: inbox.yours, top: inbox.items.slice(0, PERSONAL_BRIEF_TOP) };

  const ownOldest = inbox.items.filter(i => i.yours);
  const writtenActions = (written?.actions ?? []).slice(0, MAX_ACTIONS).map(a => ({ label: a.label.trim(), why: a.why.trim() })).filter(a => a.label);
  const actions: SuggestedAction[] = writtenActions.length > 0
    ? writtenActions
    : ownOldest.slice(0, MAX_ACTIONS).map(d => ({ label: `Take “${d.title.slice(0, 50)}”`, why: `Waiting on you in ${d.workspace.name} since ${formatDate(d.at, timeZone)}.` }));

  const parts: PersonalBriefParts = { kind, waiting, workspaces, unavailable: inbox.unavailable, timeZone, facts, written, actions: actions.length };
  return {
    kind,
    day: opts.day ?? dayKey(now, timeZone),
    title: briefingTitle(KIND_NAME[kind], now, timeZone),
    at: now,
    waiting,
    workspaces,
    unavailable: inbox.unavailable,
    actions,
    lead: leadOf(parts),
    markdown: renderPersonalBrief(parts),
  };
}

export type PublishedPersonalBrief = { id: number; orgId: string; href: string; replaced: boolean; brief: PersonalBrief; budget: { ok: true } | { ok: false; why: string } };

/**
 * Compose the brief and keep it in the person's personal workspace, as that
 * day's edition of its kind: a second publish the same day refreshes the row
 * rather than sitting beside it. The model is asked only when the brief
 * budget allows (`budgetGate.ts`); otherwise the brief is composed from the
 * facts alone, so asking never spends past the Org's cap.
 * @param userId - The person.
 * @param accountId - The account whose personal workspace keeps it.
 * @param opts - As {@link PersonalBriefOptions}; the writer defaults to the model.
 * @returns The stored brief's id, where it lives, whether it refreshed today's, and what it says.
 */
export async function publishPersonalBrief(userId: string, accountId: string, opts: PersonalBriefOptions = {}): Promise<PublishedPersonalBrief> {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;
  const kind = opts.kind ?? 'brief';
  const day = opts.day ?? dayKey(now, timeZone);
  const personal = await ensurePersonalProject(userId, accountId);
  const writer = opts.writer === undefined ? modelWriter : opts.writer;
  const budget = writer ? await briefBudget({ accountId, personalOrgId: personal.id, now }) : { ok: true as const };
  const brief = await composePersonalBrief(userId, accountId, { ...opts, now, timeZone, kind, day, writer: budget.ok ? writer : null });

  const edition = personalEdition(kind, day);
  const values = { title: brief.title.slice(0, 200), content: brief.markdown, publishedBy: PERSONAL_BRIEF_PUBLISHER, agentSlug: null, teamSlug: null, document: null, edition };
  const href = (id: number) => workspaceUrl(personal.slug, briefingHref(id));
  const [existing] = await db
    .select({ id: briefingSchema.id })
    .from(briefingSchema)
    .where(and(eq(briefingSchema.orgId, personal.id), eq(briefingSchema.edition, edition)))
    .limit(1);
  let id: number;
  if (existing) {
    await db.update(briefingSchema).set({ ...values, createdAt: now }).where(and(eq(briefingSchema.orgId, personal.id), eq(briefingSchema.id, existing.id)));
    id = existing.id;
  } else {
    const [row] = await db.insert(briefingSchema).values({ orgId: personal.id, ...values, createdAt: now }).returning({ id: briefingSchema.id });
    id = row!.id;
  }
  // A brief read is a look: the next one's "since you last looked" starts here.
  await db.update(personalRhythmSchema)
    .set(kind === 'brief' ? { lastBriefAt: now } : { lastWrapAt: now })
    .where(and(eq(personalRhythmSchema.userId, userId), eq(personalRhythmSchema.accountId, accountId)));
  return { id, orgId: personal.id, href: href(id), replaced: Boolean(existing), brief, budget };
}
