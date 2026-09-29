/**
 * The router — which registered agent answers a message nobody addressed.
 *
 * A person who types `@wiki-researcher` has chosen; a channel binding or a
 * mailbox has chosen for them. Everywhere else — the composer with no tag,
 * an MCP client asking the workspace — the workspace lead answered, and
 * delegated from there by judgement. That is right when the lead is the
 * front door and wrong when a specialist plainly owns the question: a wiki
 * question answered by a revenue lead who consults the researcher costs a
 * hop, a model call and the researcher's own initiative.
 *
 * So the choice is made here, once, in code a person can read and a test can
 * pin, and it is written down: which agents were considered, which was
 * picked, and why. Every agent may say what it `handles` — a short list of
 * topics, intents or example asks in its manifest; the router matches the
 * message against that first, then against the description and the
 * suggestions (the chips the agent opens with, which already say what it is
 * good for). A tie goes to the agent with more `initiative`, then to the
 * workspace lead. Nothing convincing, and the lead answers as before.
 *
 * Deliberately lexical, not a model call: the decision has to be cheap enough
 * to make on every turn, deterministic enough to test, and legible enough
 * that the reason it records is the reason it used. A model would route a
 * little better on hard cases and explain itself a little worse on all of
 * them.
 */

import type { Initiative } from '@/services/agents/initiative';
import type { AgentRow } from '@/services/AgentService';
import { INITIATIVE_RANK, readInitiative } from '@/services/agents/initiative';
import { listAgents } from '@/services/AgentService';
import { getWorkspaceLead } from '@/services/TeamService';

export type { Initiative } from '@/services/agents/initiative';
export { INITIATIVE_RANK, readInitiative } from '@/services/agents/initiative';

/** What the router knows about one agent. A projection of the row, so a test can hand in literals. */
export type RoutableAgent = {
  slug: string;
  name: string;
  description?: string | null;
  handles?: string[] | null;
  suggestions?: Array<{ label: string; prompt: string }> | null;
  initiative?: Initiative | null;
  active?: string | boolean | null;
};

/** One agent the router weighed, in the order it ranked them. */
export type RoutingCandidate = {
  slug: string;
  score: number;
  initiative: Initiative;
  /** What matched, in the words the manifest used — `handles: wiki`, `description: research`. */
  matched: string[];
};

/** The decision, as recorded on the message it was made for and returned to the caller. */
export type RoutingDecision = {
  /** The agent that answers. */
  chosen: string;
  /** True when nothing matched well enough and the workspace lead answered by default. */
  defaulted: boolean;
  /** One sentence a person can check against the candidates. */
  reason: string;
  /** The agents considered, best first. At most {@link MAX_CANDIDATES}. */
  candidates: RoutingCandidate[];
  /** Where the message came from — `chat`, `mcp` — for the record. */
  surface: string;
  /** When the decision was made. */
  at: string;
};

/** Weights. A `handles` entry is authored for exactly this purpose, so it outranks incidental overlap. */
const HANDLE_PHRASE = 3;
const HANDLE_WORDS = 2;
const DESCRIPTION_WORD = 1;
const SUGGESTION_WORD = 0.5;
const DESCRIPTION_CAP = 3;
const SUGGESTION_CAP = 2;
/** Below this the match is coincidence — a shared "the" or "report" — and the lead answers. */
export const MIN_ROUTE_SCORE = 2;
const MAX_CANDIDATES = 5;

/** Words that carry no topic. Short, on purpose: a longer list starts deciding what a topic is. */
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'what',
  'when',
  'where',
  'which',
  'who',
  'how',
  'why',
  'can',
  'could',
  'would',
  'should',
  'will',
  'does',
  'did',
  'have',
  'has',
  'had',
  'are',
  'was',
  'were',
  'been',
  'you',
  'your',
  'our',
  'ours',
  'its',
  'they',
  'them',
  'their',
  'about',
  'into',
  'onto',
  'over',
  'under',
  'please',
  'want',
  'need',
  'like',
  'just',
  'also',
  'not',
  'any',
  'all',
  'some',
  'one',
  'out',
  'get',
  'make',
  'tell',
  'give',
  'show',
  'know',
  'think',
  'thing',
  'things',
  'something',
  'here',
  'there',
  'then',
  'than',
  'agent',
  'agents',
  'every',
  'each',
  'more',
  'most',
  'much',
  'many',
  'very',
  'really',
  'today',
  'now',
]);

/**
 * Lower-case words of three letters or more, minus the stopwords, with a
 * crude singular so `plans` meets `plan` and `decisions` meets `decision`.
 * @param text - Any prose.
 */
export function topicWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) {
      continue;
    }
    out.add(raw);
    if (raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss')) {
      out.add(raw.slice(0, -1));
    }
  }
  return out;
}

function isActive(agent: RoutableAgent): boolean {
  return agent.active === undefined || agent.active === null || agent.active === true || agent.active === 'true';
}

/**
 * Score one agent against the message. Pure.
 * @param agent - The agent.
 * @param message - The message as typed.
 * @param words - `topicWords(message)`, computed once by the caller.
 */
export function scoreAgent(agent: RoutableAgent, message: string, words: Set<string>): RoutingCandidate {
  const lower = message.toLowerCase();
  const matched: string[] = [];
  let score = 0;

  for (const handle of agent.handles ?? []) {
    const phrase = handle.trim().toLowerCase();
    if (!phrase) {
      continue;
    }
    if (lower.includes(phrase)) {
      score += HANDLE_PHRASE;
      matched.push(`handles: ${handle}`);
      continue;
    }
    const parts = [...topicWords(phrase)];
    if (parts.length > 0 && parts.every(p => words.has(p))) {
      score += HANDLE_WORDS;
      matched.push(`handles: ${handle}`);
    }
  }

  const descriptionHits = [...topicWords(agent.description ?? '')].filter(w => words.has(w)).slice(0, DESCRIPTION_CAP);
  if (descriptionHits.length > 0) {
    score += descriptionHits.length * DESCRIPTION_WORD;
    matched.push(`description: ${descriptionHits.join(', ')}`);
  }

  const suggestionText = (agent.suggestions ?? []).map(s => `${s.label} ${s.prompt}`).join(' ');
  const suggestionHits = [...topicWords(suggestionText)].filter(w => words.has(w)).slice(0, SUGGESTION_CAP);
  if (suggestionHits.length > 0) {
    score += suggestionHits.length * SUGGESTION_WORD;
    matched.push(`suggestions: ${suggestionHits.join(', ')}`);
  }

  return { slug: agent.slug, score, initiative: readInitiative(agent.initiative), matched };
}

/**
 * Pick the agent for a message from a given roster. Pure — the database read
 * is {@link routeMessage}.
 *
 * The rule: score every active agent; the best score wins if it clears
 * {@link MIN_ROUTE_SCORE}; an exact tie goes to the higher `initiative`,
 * then to the lead, then to the slug that sorts first (so the outcome never
 * depends on row order). Nothing clears the bar, and the lead answers —
 * `leadSlug` when it names an active agent, else the first active agent.
 * @param opts - The roster and the message.
 * @param opts.agents - Every agent the caller may route to; inactive ones are skipped.
 * @param opts.message - The message as typed.
 * @param opts.leadSlug - `project.leadAgentSlug`, the default.
 * @param opts.surface - Where the message came from, for the record.
 */
export function chooseAgent(opts: { agents: RoutableAgent[]; message: string; leadSlug?: string | null; surface: string }): RoutingDecision | null {
  const active = opts.agents.filter(isActive);
  if (active.length === 0) {
    return null;
  }
  const lead = (opts.leadSlug && active.some(a => a.slug === opts.leadSlug)) ? opts.leadSlug : active[0]!.slug;
  const words = topicWords(opts.message);
  const scored = active
    .map(a => scoreAgent(a, opts.message, words))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (INITIATIVE_RANK[b.initiative] !== INITIATIVE_RANK[a.initiative]) {
        return INITIATIVE_RANK[b.initiative] - INITIATIVE_RANK[a.initiative];
      }
      if ((a.slug === lead) !== (b.slug === lead)) {
        return a.slug === lead ? -1 : 1;
      }
      return a.slug.localeCompare(b.slug);
    });
  const candidates = scored.slice(0, MAX_CANDIDATES);
  const best = scored[0]!;
  const at = new Date().toISOString();

  if (best.score < MIN_ROUTE_SCORE) {
    return {
      chosen: lead,
      defaulted: true,
      reason: best.score > 0
        ? `No agent's handles or description matched the message well enough (best was ${best.slug} at ${best.score}, the bar is ${MIN_ROUTE_SCORE}); the workspace lead answers.`
        : 'Nothing in the message matched what any agent handles; the workspace lead answers.',
      candidates,
      surface: opts.surface,
      at,
    };
  }

  const runnerUp = scored[1];
  const tied = runnerUp !== undefined && runnerUp.score === best.score;
  const why = best.matched.join('; ');
  const tieNote = tied
    ? (INITIATIVE_RANK[best.initiative] > INITIATIVE_RANK[runnerUp.initiative]
        ? ` Tied with ${runnerUp.slug}; ${best.slug} has more initiative (${best.initiative} over ${runnerUp.initiative}).`
        : best.slug === lead
          ? ` Tied with ${runnerUp.slug}; ${best.slug} is the workspace lead.`
          : ` Tied with ${runnerUp.slug}; ${best.slug} sorts first.`)
    : '';
  return {
    chosen: best.slug,
    defaulted: false,
    reason: `${best.slug} matched ${why} (score ${best.score}).${tieNote}`,
    candidates,
    surface: opts.surface,
    at,
  };
}

/**
 * The agent a message names, if any: `@slug`, or "ask the <name>" / "ask
 * <slug>". Only active agents count; the first one named wins.
 * @param agents - The roster.
 * @param message - The message as typed.
 */
export function namedAgent(agents: RoutableAgent[], message: string): string | null {
  const text = (message ?? '').toLowerCase();
  for (const agent of agents.filter(isActive)) {
    const slug = agent.slug.toLowerCase();
    const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const names = [slug, slug.replace(/-/g, ' '), agent.name.toLowerCase()].map(escape);
    if (new RegExp(`(?:^|\\s)@${escape(slug)}(?![\\w-])`).test(text)) {
      return agent.slug;
    }
    if (names.some(n => new RegExp(`\\bask (?:the |our )?${n}\\b`).test(text))) {
      return agent.slug;
    }
  }
  return null;
}

/**
 * A FOLLOW-UP STAYS WITH THE THREAD'S AGENT (one obvious path).
 *
 * Conversation 349 (2026-09-28): the product manager's thread got "You said
 * nothing was saved. Please file it now.", and the router, scoring every
 * turn afresh, sent it to change-reviewer ("matched description: file,
 * nothing", score 2) — an agent that had not been in the thread, answering
 * for work it never saw. The router chooses who answers a conversation's
 * FIRST turn. After that the thread's agent answers, unless the person names
 * another (`@slug`, "ask the <name>") or the thread was handed to another
 * agent — which is what `threadAgent` reads: the agent of the thread's last
 * reply, so a hand-off that answered moves the thread with it.
 *
 * An agent the person names wins on any turn. Otherwise null when the
 * router should decide: no reply in the thread yet, or its agent is no
 * longer active.
 * @param opts - The roster, the message, the thread's agent, the surface.
 * @param opts.agents - Every agent the caller may route to.
 * @param opts.message - The message as typed.
 * @param opts.threadAgent - The agent of the thread's last reply; null on a first turn.
 * @param opts.surface - Where the message came from, for the record.
 */
export function followUpDecision(opts: { agents: RoutableAgent[]; message: string; threadAgent: string | null; surface: string }): RoutingDecision | null {
  const at = new Date().toISOString();
  const named = namedAgent(opts.agents, opts.message);
  if (named && named !== opts.threadAgent) {
    return { chosen: named, defaulted: false, reason: `The person named ${named}${opts.threadAgent ? `; the thread was with ${opts.threadAgent}` : ''}.`, candidates: [], surface: opts.surface, at };
  }
  if (!opts.threadAgent) {
    return null;
  }
  const thread = opts.agents.find(a => a.slug === opts.threadAgent);
  if (!thread || !isActive(thread)) {
    return null;
  }
  return {
    chosen: thread.slug,
    defaulted: false,
    reason: `A follow-up in a thread with ${thread.slug} stays with ${thread.slug}; the router picks only a conversation's first turn.`,
    candidates: [],
    surface: opts.surface,
    at,
  };
}

/**
 * A CHAT ON A RECORD'S PAGE IS THE RECORD OWNER'S (the page is the context).
 *
 * Conversation 362 (2026-09-29): on request #227's page the person wrote
 * "Three changes to this request: …"; the router scored the words, sent it to
 * change-reviewer on "changes", and change-reviewer read the record and
 * answered "two edits written to the record" with nothing written. The type
 * says who answers for its records (`x-owner` in its schema); on its page
 * that agent answers the conversation's first turn, unless the person names
 * another. Null when the page names no record, the type names no owner, or
 * the owner is not an active agent here — the router decides then.
 * @param opts - The roster, the message, the page's record and its owner.
 * @param opts.agents - Every agent the caller may route to.
 * @param opts.message - The message as typed.
 * @param opts.record - The page's record: its type and id.
 * @param opts.record.objectType - The record's type slug.
 * @param opts.record.id - The record's id.
 * @param opts.ownerSlug - The type's `x-owner`.
 * @param opts.surface - Where the message came from, for the record.
 */
export function pageOwnerDecision(opts: { agents: RoutableAgent[]; message: string; record: { objectType: string; id: string | number } | null; ownerSlug: string | null; surface: string }): RoutingDecision | null {
  if (!opts.record || !opts.ownerSlug) {
    return null;
  }
  const at = new Date().toISOString();
  const named = namedAgent(opts.agents, opts.message);
  if (named) {
    return { chosen: named, defaulted: false, reason: `The person named ${named}.`, candidates: [], surface: opts.surface, at };
  }
  const owner = opts.agents.find(a => a.slug === opts.ownerSlug);
  if (!owner || !isActive(owner)) {
    return null;
  }
  const kind = opts.record.objectType.replace(/[_-]+/g, ' ');
  return {
    chosen: owner.slug,
    defaulted: false,
    reason: `The page is ${kind} #${opts.record.id}, and ${owner.slug} answers for ${kind}s on their page.`,
    candidates: [],
    surface: opts.surface,
    at,
  };
}

/**
 * The agent a type names as answering for its records (`x-owner` in its
 * stored schema), or null.
 * @param orgId - The workspace.
 * @param typeSlug - The type.
 */
export async function recordOwnerSlug(orgId: string, typeSlug: string | null | undefined): Promise<string | null> {
  if (!typeSlug) {
    return null;
  }
  try {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { businessObjectTypeSchema } = await import('@/models/Schema');
    const [row] = await db
      .select({ schema: businessObjectTypeSchema.schema })
      .from(businessObjectTypeSchema)
      .where(and(eq(businessObjectTypeSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, typeSlug)))
      .limit(1);
    const owner = (row?.schema as Record<string, unknown> | null)?.['x-owner'];
    return typeof owner === 'string' && owner.trim() ? owner.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The projection of an agent row the router reads.
 * @param row
 */
export function routableFromRow(row: Pick<AgentRow, 'slug' | 'name' | 'description' | 'handles' | 'suggestions' | 'initiative' | 'active'>): RoutableAgent {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    handles: row.handles,
    suggestions: row.suggestions,
    initiative: readInitiative(row.initiative),
    active: row.active,
  };
}

/**
 * Route a message for an org: the roster from the database, the lead from
 * the project. Null when the org has no active agent at all.
 * @param opts - The org, the message and where it came from.
 * @param opts.orgId
 * @param opts.message
 * @param opts.surface
 */
export async function routeMessage(opts: { orgId: string; message: string; surface: string }): Promise<RoutingDecision | null> {
  const [agents, lead] = await Promise.all([listAgents(opts.orgId), getWorkspaceLead(opts.orgId)]);
  return chooseAgent({
    agents: agents.map(routableFromRow),
    message: opts.message,
    leadSlug: lead.leadAgentSlug,
    surface: opts.surface,
  });
}
