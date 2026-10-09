/**
 * When each person's brief and wrap go out (docs/guides/morning-brief.md).
 * This is only the scheduler: what a brief says, where it is kept and what it
 * may spend belong to the briefings module (`services/briefings/personal.ts`,
 * `personalDelivery.ts`, `budgetGate.ts`), the same code the Briefings page's
 * own "your day" button runs.
 *
 * One deployment-wide sweep every five minutes (`personal.rhythm-sweep`, on
 * the durable executor) does three things:
 *
 *   1. gives every Personal workspace a `personal_rhythm` row if it has none,
 *      with the defaults (07:30 and 17:30) in the workspace's zone, so nobody
 *      has to find a settings page to get a brief;
 *   2. for each row whose next brief or wrap is due, starts one durable job
 *      (`personal.rhythm`) under an id naming the person, the kind and the
 *      day — the same id never runs twice, so a sweep that runs twice, or two
 *      executors, deliver once;
 *   3. moves that row's next time to the following day.
 *
 * A delivery more than two hours late (the server was down) is skipped, not
 * sent: a morning brief at two in the afternoon is not one. So is one for a
 * person who has not been here in seven days, or whose Org turned daily
 * briefs off (`services/briefings/budgetGate.ts`): their next time still moves on, so nothing piles up.
 */

import type { RhythmKind } from '@/libs/personal/rhythm';
import process from 'node:process';
import { and, eq, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { DEFAULT_RHYTHM_TIMES, dueAction, isWallClock, nextOccurrence, rhythmDay } from '@/libs/personal/rhythm';
import { isValidTimeZone, resolveTimeZone } from '@/libs/time/zone';
import { accountMembershipSchema, personalRhythmSchema, projectSchema } from '@/models/Schema';

/** A person's rhythm settings, as Personal settings shows them. */
export type RhythmSettings = {
  briefAt: string;
  wrapAt: string;
  briefOn: boolean;
  wrapOn: boolean;
  timeZone: string;
  /** Whether the zone was chosen (by the person or their browser) or is the fallback. */
  zoneChosen: boolean;
  nextBriefAt: Date | null;
  nextWrapAt: Date | null;
  /** Push beyond the app (docs/guides/push-to-you.md). */
  pushChannels: Array<'slack' | 'sms' | 'email'>;
  pushMode: 'brief_and_urgent' | 'urgent';
  quietStart: string | null;
  quietEnd: string | null;
};

type Row = typeof personalRhythmSchema.$inferSelect;

/**
 * The zone a row runs in: its own, else the server's default (`VOCION_TIMEZONE`), else UTC.
 * @param row - The row.
 * @param row.timeZone - Its zone.
 */
function zoneOf(row: Pick<Row, 'timeZone'>): string {
  return resolveTimeZone(row.timeZone, process.env.VOCION_TIMEZONE);
}

/**
 * The next brief and wrap instants for settings, after `now`.
 * @param s - The settings.
 * @param s.briefAt - Brief time.
 * @param s.wrapAt - Wrap time.
 * @param s.briefOn - Brief on.
 * @param s.wrapOn - Wrap on.
 * @param tz - The zone.
 * @param now - The clock.
 */
function nextTimes(s: Pick<Row, 'briefAt' | 'wrapAt' | 'briefOn' | 'wrapOn'>, tz: string, now: Date): { nextBriefAt: Date | null; nextWrapAt: Date | null } {
  return {
    nextBriefAt: s.briefOn ? nextOccurrence(s.briefAt, tz, now) : null,
    nextWrapAt: s.wrapOn ? nextOccurrence(s.wrapAt, tz, now) : null,
  };
}

/**
 * Give every Personal workspace's owner, still in its Org, a rhythm row.
 * @param now - The clock.
 * @returns How many rows were made.
 */
export async function ensureRhythmRows(now: Date): Promise<number> {
  const missing = await db
    .select({ userId: projectSchema.ownerUserId, accountId: projectSchema.accountId, timeZone: projectSchema.timeZone })
    .from(projectSchema)
    .innerJoin(accountMembershipSchema, and(eq(accountMembershipSchema.accountId, projectSchema.accountId), eq(accountMembershipSchema.userId, projectSchema.ownerUserId)))
    .leftJoin(personalRhythmSchema, and(eq(personalRhythmSchema.accountId, projectSchema.accountId), eq(personalRhythmSchema.userId, projectSchema.ownerUserId)))
    .where(and(eq(projectSchema.kind, 'personal'), isNotNull(projectSchema.ownerUserId), isNull(personalRhythmSchema.userId)))
    .limit(500);
  for (const m of missing) {
    const tz = resolveTimeZone(m.timeZone, process.env.VOCION_TIMEZONE);
    const times = nextTimes({ briefAt: DEFAULT_RHYTHM_TIMES.brief, wrapAt: DEFAULT_RHYTHM_TIMES.wrap, briefOn: true, wrapOn: true }, tz, now);
    await db.insert(personalRhythmSchema).values({ userId: m.userId!, accountId: m.accountId, ...times }).onConflictDoNothing();
  }
  return missing.length;
}

/** What the sweep did, for its log line and its test. */
export type SweepResult = { made: number; started: Array<{ userId: string; accountId: string; kind: RhythmKind; day: string }>; skipped: number; inactive: number };

/** How a due delivery is started: a durable job under a once-only id. */
export type StartDelivery = (id: string, input: { userId: string; accountId: string; kind: RhythmKind; day: string; timeZone: string }) => Promise<void>;

const startWithJob: StartDelivery = async (id, input) => {
  const { startJob } = await import('@/libs/durable/jobs');
  const { JOB } = await import('@/services/background/catalog');
  await startJob(id, { job: JOB.personalRhythm, input });
};

/**
 * The sweep: rows made, due deliveries started, next times moved on.
 * @param now - The clock.
 * @param start - How a delivery starts (a seam for tests).
 */
export async function sweepRhythms(now: Date = new Date(), start: StartDelivery = startWithJob): Promise<SweepResult> {
  const made = await ensureRhythmRows(now);
  const due = await db
    .select()
    .from(personalRhythmSchema)
    .where(or(lte(personalRhythmSchema.nextBriefAt, now), lte(personalRhythmSchema.nextWrapAt, now)))
    .limit(500);
  const result: SweepResult = { made, started: [], skipped: 0, inactive: 0 };
  // Only people still in an Org with briefs on, who were here this week (`services/briefings/budgetGate.ts`).
  const { eligibleForBriefs } = await import('@/services/briefings/budgetGate');
  const eligible = await eligibleForBriefs(due, now);
  for (const row of due) {
    const wanted = eligible.has(`${row.userId}:${row.accountId}`);
    const tz = zoneOf(row);
    const moves: Partial<Row> = {};
    for (const kind of ['brief', 'wrap'] as const) {
      const at = kind === 'brief' ? row.nextBriefAt : row.nextWrapAt;
      if (!at) {
        continue;
      }
      const action = dueAction(at, now);
      if (action === 'wait') {
        continue;
      }
      if (action === 'deliver' && !wanted) {
        result.inactive += 1;
      } else if (action === 'deliver') {
        const day = rhythmDay(at, tz);
        await start(`personal-rhythm:${row.userId}:${row.accountId}:${kind}:${day}`, { userId: row.userId, accountId: row.accountId, kind, day, timeZone: tz });
        result.started.push({ userId: row.userId, accountId: row.accountId, kind, day });
      } else {
        result.skipped += 1;
      }
      const next = nextOccurrence(kind === 'brief' ? row.briefAt : row.wrapAt, tz, now);
      if (kind === 'brief') {
        moves.nextBriefAt = next;
      } else {
        moves.nextWrapAt = next;
      }
    }
    if (Object.keys(moves).length > 0) {
      await db.update(personalRhythmSchema).set(moves).where(and(eq(personalRhythmSchema.userId, row.userId), eq(personalRhythmSchema.accountId, row.accountId)));
    }
  }
  return result;
}

/**
 * A person's rhythm, made with the defaults if they have none yet.
 * @param userId - The person.
 * @param accountId - Their Org.
 * @param now - The clock.
 */
export async function getRhythm(userId: string, accountId: string, now: Date = new Date()): Promise<RhythmSettings> {
  let [row] = await db.select().from(personalRhythmSchema).where(and(eq(personalRhythmSchema.userId, userId), eq(personalRhythmSchema.accountId, accountId))).limit(1);
  if (!row) {
    const tz = resolveTimeZone(process.env.VOCION_TIMEZONE);
    await db.insert(personalRhythmSchema).values({ userId, accountId, ...nextTimes({ briefAt: DEFAULT_RHYTHM_TIMES.brief, wrapAt: DEFAULT_RHYTHM_TIMES.wrap, briefOn: true, wrapOn: true }, tz, now) }).onConflictDoNothing();
    [row] = await db.select().from(personalRhythmSchema).where(and(eq(personalRhythmSchema.userId, userId), eq(personalRhythmSchema.accountId, accountId))).limit(1);
  }
  const r = row!;
  return { briefAt: r.briefAt, wrapAt: r.wrapAt, briefOn: r.briefOn, wrapOn: r.wrapOn, timeZone: zoneOf(r), zoneChosen: Boolean(r.timeZone), nextBriefAt: r.nextBriefAt, nextWrapAt: r.nextWrapAt, pushChannels: r.pushChannels.filter((c): c is 'slack' | 'sms' | 'email' => c === 'slack' || c === 'sms' || c === 'email'), pushMode: r.pushMode, quietStart: r.quietStart, quietEnd: r.quietEnd };
}

/** A change to a rhythm. Every field optional; invalid ones are refused. */
export type RhythmChange = Partial<Pick<RhythmSettings, 'briefAt' | 'wrapAt' | 'briefOn' | 'wrapOn' | 'timeZone' | 'pushChannels' | 'pushMode' | 'quietStart' | 'quietEnd'>>;

/**
 * Why a change cannot be saved, or null when it can.
 * @param change - The change.
 */
export function rhythmChangeProblem(change: RhythmChange): string | null {
  if (change.briefAt !== undefined && !isWallClock(change.briefAt)) {
    return 'The brief time must be HH:MM on a 24-hour clock.';
  }
  if (change.wrapAt !== undefined && !isWallClock(change.wrapAt)) {
    return 'The wrap time must be HH:MM on a 24-hour clock.';
  }
  if (change.timeZone !== undefined && !isValidTimeZone(change.timeZone)) {
    return 'That is not a time zone this server knows.';
  }
  if (change.pushChannels !== undefined && change.pushChannels.some(c => !['slack', 'sms', 'email'].includes(c))) {
    return 'Push goes to Slack, text or email.';
  }
  for (const [label, v] of [['start', change.quietStart], ['end', change.quietEnd]] as const) {
    if (v !== undefined && v !== null && !isWallClock(v)) {
      return `Quiet hours ${label} must be HH:MM on a 24-hour clock.`;
    }
  }
  return null;
}

/**
 * Save a change and move the next deliveries to match.
 * @param userId - The person.
 * @param accountId - Their Org.
 * @param change - What changed.
 * @param now - The clock.
 */
export async function setRhythm(userId: string, accountId: string, change: RhythmChange, now: Date = new Date()): Promise<RhythmSettings> {
  const problem = rhythmChangeProblem(change);
  if (problem) {
    throw new Error(problem);
  }
  const current = await getRhythm(userId, accountId, now);
  const merged = {
    briefAt: change.briefAt ?? current.briefAt,
    wrapAt: change.wrapAt ?? current.wrapAt,
    briefOn: change.briefOn ?? current.briefOn,
    wrapOn: change.wrapOn ?? current.wrapOn,
  };
  const timeZone = change.timeZone ?? (current.zoneChosen ? current.timeZone : null);
  const push = {
    ...(change.pushChannels !== undefined ? { pushChannels: [...new Set(change.pushChannels)] } : {}),
    ...(change.pushMode !== undefined ? { pushMode: change.pushMode } : {}),
    ...(change.quietStart !== undefined ? { quietStart: change.quietStart } : {}),
    ...(change.quietEnd !== undefined ? { quietEnd: change.quietEnd } : {}),
  };
  await db.update(personalRhythmSchema)
    .set({ ...merged, ...push, timeZone, ...nextTimes(merged, timeZone ?? current.timeZone, now), updatedAt: sql`now()` })
    .where(and(eq(personalRhythmSchema.userId, userId), eq(personalRhythmSchema.accountId, accountId)));
  return getRhythm(userId, accountId, now);
}
