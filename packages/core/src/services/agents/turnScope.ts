/**
 * THE TURN A WRITE HAPPENS IN — one seam, not a rule per tool.
 *
 * A chat turn reads what the person wants once, before it runs
 * (`turnJudge.readIntent`). When they asked a question, the turn is
 * read-only: every write an agent makes lands in `ActionService.proposeAction`
 * or a decide path, and each of those asks this scope first. A question can
 * then never file a record, change one, or put up a card (CHAT-423,
 * 2026-10-01: five questions on a feature's page filed two features, rewrote
 * the one they were about, rejected its merge and started three builds).
 *
 * The same scope counts what landed, so the turn knows from the writes
 * themselves, never from the reply's words, whether an act it was asked for
 * happened.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type TurnScope = {
  /** The person asked a question: nothing is written in this turn. */
  readOnly: boolean;
  /** Writes that landed in this turn (a record, a change, a card, a decision). */
  writes: number;
  /**
   * Resolves when the turn knows what it may do — the intent read is in, and
   * a head start has been picked (`agents/turnGate.ts`). The model runs
   * before then; a write waits for it ({@link settleTurn}).
   */
  ready?: () => Promise<void>;
};

const storage = new AsyncLocalStorage<TurnScope>();

/** What a write in a read-only turn answers, for the agent to act on. */
export const READ_ONLY_RECEIPT = 'Not written: they asked a question. Answer it from what you read; offer the change in one line if it would help.';

/**
 * Run `fn` inside a turn's scope.
 * @param scope - The turn.
 * @param fn - The work.
 */
export function inTurn<T>(scope: TurnScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

/** The turn this code runs in, when it runs in one. */
export function currentTurn(): TurnScope | undefined {
  return storage.getStore();
}

/**
 * Wait until the current turn knows whether it may write. Every write seam
 * calls this before {@link writesRefused}: the turn's model starts before
 * the intent read has answered, and a write must not race it.
 */
export async function settleTurn(): Promise<void> {
  await storage.getStore()?.ready?.();
}

/** True when the current turn may not write. */
export function writesRefused(): boolean {
  return storage.getStore()?.readOnly === true;
}

/** A write landed in the current turn. */
export function noteWrite(): void {
  const scope = storage.getStore();
  if (scope) {
    scope.writes += 1;
  }
}
