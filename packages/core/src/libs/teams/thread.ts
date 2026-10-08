/**
 * TEAM THREADS — one question, put by a lead to its specialists, who read
 * each other's posts and answer them until a rule settles it.
 *
 * Delegation with the `task` tool is a tree: the lead asks one specialist,
 * gets one answer, and no specialist ever sees another's. A thread is the
 * other shape a team needs — a question that wants the people who know to
 * disagree, correct and add to each other — kept bounded and owned:
 *
 *   - it ends on a SETTLE RULE, whichever comes first: the lead declares it
 *     done, every assigned member marks its part complete, or the round cap or
 *     the budget cap is reached. A person cancelling it ends it too;
 *   - the lead writes the outcome, always — a thread never ends on a
 *     transcript nobody summed up;
 *   - it is ONE RUN (`mission_run`): its posts are the run's steps, its cost is
 *     the run's cost, its owner is the lead and the team's accountable human.
 *     Nothing here is a second history (principle 7).
 *
 * This module is the pure half — the shape stored on the run, the rule, the
 * words each turn is given and the view a page draws. Safe on the client.
 * The loop that runs a thread is `services/teams/TeamThreadService.ts`.
 */

/** Why a thread ended. */
export const THREAD_SETTLE_REASONS = ['lead', 'all_complete', 'budget_cap', 'round_cap', 'cancelled'] as const;
export type ThreadSettleReason = typeof THREAD_SETTLE_REASONS[number];

/**
 * How the members take their turns in a round. `parallel`: everyone posts at
 * once, each having read the thread as it stood when the round began — the
 * fast default. `sequential`: one after another, each reading every post
 * before theirs, the earlier ones of the same round included.
 */
export const THREAD_TURN_ORDERS = ['parallel', 'sequential'] as const;
export type ThreadTurnOrder = typeof THREAD_TURN_ORDERS[number];

/** The bounds. A thread is bounded by construction, whatever its opener asked for. */
export const THREAD_LIMITS = {
  defaultRounds: 3,
  maxRounds: 6,
  /** $3.00 — what one thread may spend unless its opener says otherwise. */
  defaultCapCents: 300,
  /** $50.00 — the most any opener may give one thread. */
  maxCapCents: 5000,
  /** The most members one thread assigns; more is a meeting, not a thread. */
  maxMembers: 6,
} as const;

/** Micro-cents in a cent (`services/budget/runCost.ts`). */
const MICRO_PER_CENT = 1_000_000;

/**
 * What a thread keeps on its run (`mission_run.thread`, migration 0188).
 * The posts are not here: they are the run's plan steps, written as they land.
 */
export type TeamThreadState = {
  /** The question the thread exists to settle. */
  question: string;
  /** The agent that opened it, owns it and writes the outcome. */
  lead: string;
  /** The team the lead leads, when it leads one (`team.slug`). */
  teamSlug: string | null;
  /** The team's accountable human (else the workspace's), resolved when the thread opened. */
  accountableUserId: string | null;
  /** The specialists assigned to it, in roster order. */
  members: string[];
  turnOrder: ThreadTurnOrder;
  maxRounds: number;
  capCents: number;
  /** Rounds the members have finished posting. */
  round: number;
  /** Members who said their part is complete. Once complete, a member sits out later rounds. */
  complete: string[];
  settledBy: ThreadSettleReason | null;
  settledAt: string | null;
  /** The lead's outcome. Null until it is written; null forever on a cancelled thread. */
  outcome: string | null;
  /** Who opened it: `agent:<slug>` (a lead's tool call, from chat or a mission step) or `job:team-thread` (an automation). */
  openedBy: string;
  /** The person behind it, when one is — the turns run as them. */
  userId: string | null;
  /** That person's source ACL, carried to every turn: a member never reads more than they may. */
  allowedSourceSlugs: string[] | null;
  /** The run the thread was opened from (a mission step), when it was. */
  parentRunId: number | null;
  /** The conversation the thread was opened from (a lead's chat turn), when it was. */
  conversationId: number | null;
};

/** The options an opener may set; everything else is decided here. */
export type ThreadOptions = {
  maxRounds?: number;
  capCents?: number;
  turnOrder?: ThreadTurnOrder;
};

/**
 * The opener's options held to the bounds: a round cap of 1 to
 * {@link THREAD_LIMITS.maxRounds}, a budget cap of 1¢ to
 * {@link THREAD_LIMITS.maxCapCents}, and `parallel` unless `sequential` was asked for.
 * @param opts - What the opener asked for.
 */
export function boundThreadOptions(opts: ThreadOptions = {}): Required<ThreadOptions> {
  const rounds = Number.isFinite(opts.maxRounds) ? Math.trunc(opts.maxRounds!) : THREAD_LIMITS.defaultRounds;
  const cap = Number.isFinite(opts.capCents) ? Math.trunc(opts.capCents!) : THREAD_LIMITS.defaultCapCents;
  return {
    maxRounds: Math.min(Math.max(rounds, 1), THREAD_LIMITS.maxRounds),
    capCents: Math.min(Math.max(cap, 1), THREAD_LIMITS.maxCapCents),
    turnOrder: opts.turnOrder === 'sequential' ? 'sequential' : 'parallel',
  };
}

/** What the settle rule reads. */
export type SettleInput = {
  /** Rounds finished. */
  round: number;
  maxRounds: number;
  members: readonly string[];
  complete: readonly string[];
  /** The lead's last review declared the thread settled. */
  leadSettled: boolean;
  /** What the thread has spent so far, every turn and every read in it. */
  spentMicroCents: number;
  capCents: number;
  /** A person cancelled the run. */
  cancelled?: boolean;
};

/**
 * THE SETTLE RULE: whichever of these holds first ends the thread, else null.
 * In order — a person's cancel, the lead's word, every member complete, the
 * budget spent, the rounds used — so the reason recorded is the most
 * meaningful one that is true (a last round in which everyone marked complete
 * settled because they did, not because the cap was reached).
 * @param s - Where the thread stands.
 */
export function settleReason(s: SettleInput): ThreadSettleReason | null {
  if (s.cancelled) {
    return 'cancelled';
  }
  if (s.leadSettled) {
    return 'lead';
  }
  if (s.members.length > 0 && s.members.every(m => s.complete.includes(m))) {
    return 'all_complete';
  }
  if (s.spentMicroCents >= s.capCents * MICRO_PER_CENT) {
    return 'budget_cap';
  }
  if (s.round >= s.maxRounds) {
    return 'round_cap';
  }
  return null;
}

/**
 * Why the thread ended, in one sentence a person reads.
 * @param reason - The rule that settled it.
 * @param s - Where it stood.
 * @param s.round - Rounds finished.
 * @param s.maxRounds - The round cap.
 * @param s.capCents - The budget cap.
 */
export function settleLine(reason: ThreadSettleReason, s: { round: number; maxRounds: number; capCents: number }): string {
  const rounds = `${s.round} of ${s.maxRounds} round${s.maxRounds === 1 ? '' : 's'}`;
  switch (reason) {
    case 'lead':
      return `The lead declared it settled after ${rounds}.`;
    case 'all_complete':
      return `Every assigned member marked their part complete after ${rounds}.`;
    case 'budget_cap':
      return `It reached its budget cap of ${dollars(s.capCents)} after ${rounds}.`;
    case 'round_cap':
      return `It reached its round cap: ${rounds}.`;
    case 'cancelled':
      return `A person cancelled it after ${rounds}.`;
  }
}

/**
 * Cents as dollars, for a line a person reads.
 * @param cents - Whole cents.
 */
export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/* Posts — the run's plan steps                                         */
/* ------------------------------------------------------------------ */

/** A plan step as the run stores it (`mission_run.plan.tasks[]`), the fields a thread uses. */
export type ThreadTask = {
  id: string;
  title: string;
  ownerAgentSlug: string;
  type: 'analysis' | 'creative' | 'synthesis' | 'artifact' | 'diagnostic' | 'action';
  status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'skipped';
  output?: string;
  error?: string;
  traceId?: string;
  startedAt?: string;
  endedAt?: string;
};

/** What a step is in the thread. */
export type ThreadPostKind = 'post' | 'review' | 'outcome';

/** The id of the step one post is stored as. Our own identifiers, read back by {@link readPostId}. */
export const postId = {
  post: (round: number, member: string) => `r${round}:${member}`,
  review: (round: number) => `r${round}:review`,
  outcome: () => 'outcome',
};

/**
 * A step's place in the thread, from the id {@link postId} gave it; null for
 * a step that is not a thread post.
 * @param id - The step's id.
 */
export function readPostId(id: string): { kind: ThreadPostKind; round: number | null } | null {
  if (id === 'outcome') {
    return { kind: 'outcome', round: null };
  }
  const colon = id.indexOf(':');
  const round = colon > 1 && id.startsWith('r') ? Number(id.slice(1, colon)) : Number.NaN;
  if (!Number.isSafeInteger(round) || round < 1) {
    return null;
  }
  return { kind: id.slice(colon + 1) === 'review' ? 'review' : 'post', round };
}

/** An agent's display name by slug; a slug it does not know reads as itself. */
export type AgentNames = ReadonlyMap<string, string>;

function who(names: AgentNames, slug: string): string {
  const name = names.get(slug);
  return name && name !== slug ? `${name} (${slug})` : slug;
}

/** Each post is shown whole up to this many characters. */
const POST_CHARS = 4_000;
/** The whole thread, as one turn reads it, is held to this many characters, newest posts first. */
const TRANSCRIPT_CHARS = 40_000;

/**
 * The thread as one turn reads it: every post so far, in order, with who
 * wrote it. When it would run past {@link TRANSCRIPT_CHARS}, the newest posts
 * are kept whole and the oldest are named with their length instead — they
 * are on the run page, and the turn is told so.
 * @param tasks - The run's steps, in order.
 * @param names - Agent names.
 */
export function threadTranscript(tasks: readonly ThreadTask[], names: AgentNames): string {
  const entries = tasks.flatMap((t) => {
    const place = readPostId(t.id);
    if (!place || place.kind === 'outcome' || (t.status !== 'completed' && t.status !== 'failed')) {
      return [];
    }
    const head = `[${place.kind === 'review' ? `Round ${place.round} review` : `Round ${place.round}`} · ${who(names, t.ownerAgentSlug)}${place.kind === 'review' ? ' · lead' : ''}]`;
    const body = t.status === 'failed'
      ? `(This post failed and was not written: ${(t.error ?? 'no reason given').split('\n')[0]})`
      : cut(t.output ?? '', POST_CHARS);
    return [{ head, body }];
  });
  let room = TRANSCRIPT_CHARS;
  const kept: string[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    const whole = `${e.head}\n${e.body}`;
    if (whole.length <= room) {
      kept.unshift(whole);
      room -= whole.length;
    } else {
      kept.unshift(`${e.head}\n(an earlier post of ${e.body.length} characters, left out here to fit; it is on the run)`);
    }
  }
  return kept.length > 0 ? kept.join('\n\n') : '(No posts yet — you are first.)';
}

function cut(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}… (cut at ${n} characters)` : text;
}

/* ------------------------------------------------------------------ */
/* The words each turn is given                                         */
/* ------------------------------------------------------------------ */

/** What every turn in a thread is told about it. */
export type ThreadBrief = {
  question: string;
  lead: string;
  members: readonly string[];
  round: number;
  maxRounds: number;
  names: AgentNames;
  tasks: readonly ThreadTask[];
};

function header(b: ThreadBrief): string[] {
  return [
    `Question: ${b.question}`,
    `Opened and owned by: ${who(b.names, b.lead)} (the lead).`,
    `Assigned: ${b.members.map(m => who(b.names, m)).join(', ')}.`,
  ];
}

/**
 * A member's turn: the question, the thread so far, and what a post is for.
 * @param b - The thread.
 * @param member - The member posting.
 */
export function memberMessage(b: ThreadBrief, member: string): string {
  return [
    `You are ${who(b.names, member)}, posting in a TEAM THREAD your lead opened. Everyone assigned reads every post, and you read theirs.`,
    ...header(b),
    `This is round ${b.round} of at most ${b.maxRounds}.`,
    '',
    'The thread so far:',
    threadTranscript(b.tasks, b.names),
    '',
    'Write your post. Answer from your own expertise, and respond to what the others posted by name: agree, correct, or add the evidence that settles a point. Use your tools where a claim needs evidence. Add only what moves the question forward; do not repeat a point already made. If your part of the question is answered and you have nothing further to add, say so plainly — that marks your part complete and you sit out the rest.',
  ].join('\n');
}

/**
 * The lead's turn after a round: settle it with the outcome, or steer the next round.
 * @param b - The thread.
 * @param complete - Members who have marked their part complete.
 */
export function leadReviewMessage(b: ThreadBrief, complete: readonly string[]): string {
  return [
    `You opened a TEAM THREAD and you own its outcome. Round ${b.round} of at most ${b.maxRounds} has just finished.`,
    ...header(b),
    complete.length > 0 ? `Marked their part complete: ${complete.map(m => who(b.names, m)).join(', ')}.` : 'Nobody has marked their part complete yet.',
    '',
    'The thread so far:',
    threadTranscript(b.tasks, b.names),
    '',
    'Decide one of two things. If the thread has answered the question well enough to act on, declare it settled and write the outcome now: the answer, the decision and who owns the next step, and plainly what the team could not establish. Otherwise write a short steer for the next round: what is still open and who should address it, by name. Do not open another thread.',
  ].join('\n');
}

/**
 * The lead's last turn, when the thread settled on a rule other than its word.
 * @param b - The thread.
 * @param reason - The rule that settled it.
 * @param maxRoundsAndCap - The caps, for the sentence that says which one held.
 * @param maxRoundsAndCap.capCents - The budget cap.
 */
export function outcomeMessage(b: ThreadBrief, reason: ThreadSettleReason, maxRoundsAndCap: { capCents: number }): string {
  return [
    `The TEAM THREAD you opened has settled. ${settleLine(reason, { round: b.round, maxRounds: b.maxRounds, capCents: maxRoundsAndCap.capCents })}`,
    ...header(b),
    '',
    'The thread:',
    threadTranscript(b.tasks, b.names),
    '',
    'Write the outcome now: the answer to the question, the decision and who owns the next step, and plainly what the thread could not establish. Do not open another thread.',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* The view a page draws                                                */
/* ------------------------------------------------------------------ */

/** One post as a page shows it. */
export type ThreadPostView = {
  id: string;
  kind: ThreadPostKind;
  round: number | null;
  agentSlug: string;
  agentName: string;
  status: ThreadTask['status'];
  body: string | null;
  error: string | null;
  /** This post marked its author's part complete. */
  complete: boolean;
  at: string | null;
};

/** A thread as a page or an API reads it: the outcome first, then how it settled, then the posts. */
export type TeamThreadView = {
  runId: number;
  status: string;
  question: string;
  lead: { slug: string; name: string };
  /** The team's accountable human, who owns the outcome with the lead; null when none is set. */
  accountable: { userId: string; name: string } | null;
  members: Array<{ slug: string; name: string; complete: boolean }>;
  turnOrder: ThreadTurnOrder;
  round: number;
  maxRounds: number;
  capCents: number;
  /** What the thread spent, in cents; null on a run that recorded none. */
  spentCents: number | null;
  settledBy: ThreadSettleReason | null;
  /** {@link settleLine}, or null while it runs. */
  settled: string | null;
  outcome: string | null;
  posts: ThreadPostView[];
};

/** The run fields a view is built from. */
export type ThreadRunRow = {
  id: number;
  status: string;
  thread: TeamThreadState | null;
  plan: { tasks: ThreadTask[] } | null;
  microCents: number | null;
};

/**
 * A thread run as a page or an API reads it. Null for a run that is not a thread.
 * @param run - The run.
 * @param names - Agent names, when the caller has them.
 * @param accountableName - The accountable human's name, when the caller read it.
 */
export function threadViewOf(run: ThreadRunRow, names: AgentNames = new Map(), accountableName?: string | null): TeamThreadView | null {
  const t = run.thread;
  if (!t) {
    return null;
  }
  const nameOf = (slug: string) => names.get(slug) ?? slug;
  const posts = (run.plan?.tasks ?? []).flatMap((task): ThreadPostView[] => {
    const place = readPostId(task.id);
    if (!place) {
      return [];
    }
    // A member who marks complete sits out every later round, so the post
    // that marked it is that member's last.
    const complete = place.kind === 'post' && t.complete.includes(task.ownerAgentSlug) && isLastPostOf(run.plan!.tasks, task);
    return [{
      id: task.id,
      kind: place.kind,
      round: place.round,
      agentSlug: task.ownerAgentSlug,
      agentName: nameOf(task.ownerAgentSlug),
      status: task.status,
      body: task.output ?? null,
      error: task.error ?? null,
      complete,
      at: task.endedAt ?? task.startedAt ?? null,
    }];
  });
  return {
    runId: run.id,
    status: run.status,
    question: t.question,
    lead: { slug: t.lead, name: nameOf(t.lead) },
    accountable: t.accountableUserId ? { userId: t.accountableUserId, name: accountableName ?? 'the accountable owner' } : null,
    members: t.members.map(slug => ({ slug, name: nameOf(slug), complete: t.complete.includes(slug) })),
    turnOrder: t.turnOrder,
    round: t.round,
    maxRounds: t.maxRounds,
    capCents: t.capCents,
    spentCents: run.microCents === null || run.microCents === undefined ? null : Math.round(run.microCents / MICRO_PER_CENT),
    settledBy: t.settledBy,
    settled: t.settledBy ? settleLine(t.settledBy, t) : null,
    outcome: t.outcome,
    posts,
  };
}

function isLastPostOf(tasks: readonly ThreadTask[], task: ThreadTask): boolean {
  const mine = tasks.filter(x => x.ownerAgentSlug === task.ownerAgentSlug && readPostId(x.id)?.kind === 'post');
  return mine.at(-1)?.id === task.id;
}
