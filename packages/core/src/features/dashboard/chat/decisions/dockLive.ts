import type { DecisionView } from '@/libs/decisions/decision';
import { decisionKey } from '@/libs/decisions/decision';
import { liveTopic } from '@/libs/live/topics';

/**
 * THE DOCK FOLLOWS WHAT IT SHOWS (Chris, 2026-10-23: "are we streaming
 * updates to the card if they're decided or overcome by work in chat?").
 * Before this, the docked Decision was read when the thread opened and when
 * a turn landed, so one answered on Review, in another tab, in Slack or by a
 * teammate sat in the dock until the next turn. Each docked Decision is a
 * row that publishes itself on the live stream (an ask as `ask:<id>`, a
 * proposal — an action run — as `card:<id>`, migration 0155), so the dock
 * follows exactly those and reads them again when one changes. Pure.
 */

/**
 * The live topics the dock follows: one per Decision it may show.
 * @param views - The Decisions docked or queued.
 */
export function decisionTopics(views: readonly Pick<DecisionView, 'id' | 'subject'>[]): string[] {
  return [...new Set(views.map(v => (v.subject === 'proposal' ? liveTopic.card(v.id) : liveTopic.ask(v.id))))].sort();
}

/**
 * The Decisions that left the dock without an answer from here: settled on
 * Review, in another tab, in Slack, by a teammate, or withdrawn by the agent.
 * @param before - What the dock showed.
 * @param after - What it shows now.
 * @param answeredHere - Keys (`decisionKey`) answered on this page.
 */
export function settledElsewhere(before: readonly DecisionView[], after: readonly DecisionView[], answeredHere: ReadonlySet<string>): DecisionView[] {
  const still = new Set(after.map(decisionKey));
  return before.filter(d => !still.has(decisionKey(d)) && !answeredHere.has(decisionKey(d)));
}

/**
 * The one line the dock says when a Decision left it from elsewhere.
 * @param gone - What left.
 */
export function settledElsewhereLine(gone: readonly Pick<DecisionView, 'question'>[]): string {
  if (gone.length === 1) {
    return `Settled elsewhere: ${gone[0]!.question}`;
  }
  return `${gone.length} decisions were settled elsewhere.`;
}
