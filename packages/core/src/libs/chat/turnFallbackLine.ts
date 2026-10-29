/**
 * NO SILENT TURNS — the one line a turn says when the model said nothing.
 *
 * On 2026-10-29 three turns in an SEO app's chat ended with no words at all:
 * the agent put a card up, or ran its tools, and the stored answer was ''.
 * The card sat in the dock; the transcript under the person's question was
 * empty, and an empty turn reads as a broken one.
 *
 * Every turn ends with at least one line addressed to the person. When the
 * model wrote none, this composes it from what the turn DID — its cards and
 * its steps — in code, never with a model call: "Asked you to connect
 * GitHub. Once it's connected, I'll carry on from here." / "Filed the
 * keyword plan for your sign-off." It names only what happened: a card that
 * went up, a step that ran, a document that was written. It never claims an
 * outcome the turn's events do not carry.
 *
 * Pure and shared: the end-of-turn guarantees call it
 * (`services/AgentService.ts` `applyTurnGuarantees`), and any narrower guard
 * (a connect or ask turn) calls the same function rather than writing its own
 * sentence, so there is one place these lines are worded.
 */

import { fallbackStepLabels, personFacingStepLabels } from './stepLabels';

/** A card the turn put in front of the person, as the turn's events typed it. */
type TurnCardSeen = {
  /** `connect` a connection to make; `decision` a question docked above the composer; `approval` something to sign off. */
  kind: 'connect' | 'decision' | 'approval';
  /** What the card says: "Connect GitHub", the decision's question, the proposal's label. */
  title: string;
};

/** A step the turn ran. */
type TurnStepSeen = { tool: string; input?: Record<string, unknown>; output?: string };

/** Everything the line may be made from. */
export type TurnSeen = {
  cards: TurnCardSeen[];
  /** Titles of documents the turn wrote (settled `artifact` events). */
  artifacts: string[];
  steps: TurnStepSeen[];
};

/** An empty record of a turn, to fill with {@link observeTurnEvent}. */
export function emptyTurnSeen(): TurnSeen {
  return { cards: [], artifacts: [], steps: [] };
}

/** Tools that put a connection in front of the person. */
const CONNECT_TOOLS = new Set(['offer_connection', 'connect_system', 'connect_personal']);

/** The card kind "Connect your systems" is offered as (`libs/cards/card.ts` `CONNECT_SYSTEMS_CARD_KIND`). */
const CONNECT_SYSTEMS_KIND = 'connect-systems';

/**
 * The events the line reads, typed loosely so this module stays importable
 * from the client and from tests without the agent runtime's types.
 */
type SeenEvent
  = | { type: 'card'; card: { kind?: string; title: string; state?: string; source?: { tool?: string } } }
    | { type: 'recommended_action'; recommendation: { label: string } }
    | { type: 'decision'; decision: { question: string; state?: string } }
    | { type: 'hitl_gate'; gate: { question: string } }
    | { type: 'artifact'; artifact: { title: string }; pending?: boolean; delta?: string }
    | { type: string };

/**
 * Note one event of the turn. Cards that wait on the person, decisions that
 * are open, and documents that settled are kept; everything else is ignored.
 * @param seen - The turn so far; changed in place.
 * @param event - Any agent event.
 */
export function observeTurnEvent(seen: TurnSeen, event: SeenEvent): void {
  switch (event.type) {
    case 'card': {
      const { card } = event as Extract<SeenEvent, { type: 'card' }>;
      if (card.state && card.state !== 'proposed' && card.state !== 'filed') {
        return;
      }
      const connect = card.kind === CONNECT_SYSTEMS_KIND || CONNECT_TOOLS.has(card.source?.tool ?? '');
      pushCard(seen, { kind: connect ? 'connect' : 'approval', title: card.title });
      return;
    }
    case 'recommended_action':
      pushCard(seen, { kind: 'approval', title: (event as Extract<SeenEvent, { type: 'recommended_action' }>).recommendation.label });
      return;
    case 'decision': {
      const { decision } = event as Extract<SeenEvent, { type: 'decision' }>;
      if (!decision.state || decision.state === 'open') {
        pushCard(seen, { kind: 'decision', title: decision.question });
      }
      return;
    }
    case 'hitl_gate':
      pushCard(seen, { kind: 'approval', title: (event as Extract<SeenEvent, { type: 'hitl_gate' }>).gate.question });
      return;
    case 'artifact': {
      const e = event as Extract<SeenEvent, { type: 'artifact' }>;
      const title = e.artifact.title?.trim();
      if (!e.pending && e.delta === undefined && title && !seen.artifacts.includes(title)) {
        seen.artifacts.push(title);
      }
    }
  }
}

function pushCard(seen: TurnSeen, card: TurnCardSeen): void {
  const title = card.title.trim();
  if (title && !seen.cards.some(c => c.kind === card.kind && c.title === title)) {
    seen.cards.push({ kind: card.kind, title });
  }
}

/**
 * Steps whose finished work IS the line, said the way the person sees it.
 * `ok` reads the tool's own result, so a refusal ("Not planned: …") never
 * reads as done.
 */
const FILED: Record<string, { ok: RegExp; line: string }> = {
  seo_plan_batch: { ok: /^Planned batch/, line: 'Filed the keyword plan for your sign-off.' },
  seo_start_writing: { ok: /^Queued/, line: 'Started writing the released pages in the background; their progress shows here as each one lands.' },
};

/** Steps that are the runtime's own bookkeeping, never worth naming to a person. */
const PLUMBING = new Set(['write_todos', 'ls', 'glob', 'grep', 'read_file', 'edit_file', 'write_file', 'task']);

const and = (xs: readonly string[]): string => (xs.length <= 1 ? xs[0] ?? '' : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const quote = (s: string): string => `“${s.replace(/[.?!\s]+$/, '')}”`;

/**
 * What a connect card is for: "GitHub" from "Connect GitHub", else the title.
 * @param title - The card's title.
 */
function connectSubject(title: string): string {
  return title.replace(/^connect\s+(?:to\s+)?/i, '').trim() || title;
}

/**
 * Up to three names, then how many more.
 * @param titles - The names.
 */
function named(titles: readonly string[]): string {
  const shown = titles.slice(0, 3).map(quote);
  return titles.length > 3 ? `${shown.join(', ')} and ${titles.length - 3} more` : and(shown);
}

/**
 * The line a turn with no words ends on, from what it did. Always one or two
 * short sentences, never empty.
 * @param seen - The turn's cards, documents and steps.
 */
export function fallbackTurnLine(seen: TurnSeen): string {
  const lines: string[] = [];

  // A connection to make comes first: nothing else moves until it is made.
  const connects = seen.cards.filter(c => c.kind === 'connect').map(c => connectSubject(c.title));
  const connectSteps = seen.steps.filter(s => CONNECT_TOOLS.has(s.tool));
  if (connects.length > 0) {
    lines.push(`Asked you to connect ${and([...new Set(connects)])}. Once it's connected, I'll carry on from here.`);
  } else if (connectSteps.length > 0) {
    // The step ran and the card is the dock's: say what the step did, from its own words.
    const said = personFacingStepLabels(connectSteps[0]!.tool, connectSteps[0]!.input);
    if (said) {
      lines.push(`${said.done}. Once it's connected, I'll carry on from here.`);
    }
  }

  // Work a step filed for the person, in the words they see it by.
  for (const s of seen.steps) {
    const filed = FILED[s.tool];
    if (filed && filed.ok.test((s.output ?? '').trim()) && !lines.includes(filed.line)) {
      lines.push(filed.line);
    }
  }

  // A question docked above the composer, when no filed line already said it.
  const decisions = seen.cards.filter(c => c.kind === 'decision');
  if (decisions.length > 0 && lines.length === 0) {
    lines.push(decisions.length === 1 ? `One question for you: ${decisions[0]!.title.trim()}` : `${decisions.length} questions for you, docked above the box you type in.`);
  }

  // Something to sign off.
  const approvals = seen.cards.filter(c => c.kind === 'approval').map(c => c.title);
  if (approvals.length > 0 && lines.length < 2) {
    lines.push(approvals.length === 1 ? `Filed ${quote(approvals[0]!)} for your sign-off.` : `Filed ${approvals.length} items for your sign-off: ${named(approvals)}.`);
  }

  if (lines.length > 0) {
    return lines.slice(0, 2).join(' ');
  }

  // A document written is the answer: it is in the chips under this line.
  if (seen.artifacts.length > 0) {
    return seen.artifacts.length === 1 ? `Wrote ${quote(seen.artifacts[0]!)}.` : `Wrote ${seen.artifacts.length} documents: ${named(seen.artifacts)}.`;
  }

  // Steps and no words: name the last one, and offer the summary.
  const steps = seen.steps.filter(s => !PLUMBING.has(s.tool));
  if (steps.length > 0) {
    const last = steps[steps.length - 1]!;
    const done = fallbackStepLabels(last.tool, undefined, last.input).done;
    const more = steps.length - 1;
    const did = done === 'Worked on it' ? `Ran ${steps.length} step${steps.length === 1 ? '' : 's'}` : `${done}${more > 0 ? `, after ${more} other step${more === 1 ? '' : 's'}` : ''}`;
    return `${did}. Ask and I'll sum up what I found.`;
  }

  return 'I didn\'t get to an answer that time. Ask again, or put it another way, and I\'ll pick it up.';
}

/**
 * Whether a turn's text needs the line: nothing a person can read once markup
 * and whitespace are gone.
 * @param text - The turn's finished text.
 */
export function saidNothing(text: string | null | undefined): boolean {
  return (text ?? '').replace(/<[^>]*>/g, '').trim().length === 0;
}
