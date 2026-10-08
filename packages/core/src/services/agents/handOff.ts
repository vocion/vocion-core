/**
 * THE TURN ENDS WHERE IT ASKED A PERSON TO ACT.
 *
 * A card that waits on a person — a connection to make, an action to approve —
 * is the turn handing the next move to them. What the model says after it is
 * the thing the DeliveryStack workspace's first setup turn showed (Jamie,
 * 2026-10-07): three more paragraphs, a record filed from memory, the card
 * pushed to the bottom of a long answer. The skill had already said "put the
 * card up and stop"; a requirement the prompt could not hold is enforced here
 * (CLAUDE.md, structural over prompting).
 *
 * Same shape as {@link TurnBudgetGuard}: a tool marks the hand-off as it puts
 * the card up, and the guard stops the turn before the NEXT model call, so
 * every card the same model step asked for still lands and the person sees
 * the words written before them. Only a person's turn is stopped: a mission
 * run has nobody waiting, and its cards queue for Review while it carries on.
 */

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

/** The turn ended at a card a person has to act on. Not a failure. */
export class TurnHandedOff extends Error {
  constructor(public readonly cards: readonly string[]) {
    super(`the turn ended at ${cards.length === 1 ? 'a card' : `${cards.length} cards`} a person acts on: ${cards.join(', ')}`);
    this.name = 'TurnHandedOff';
  }
}

export class HandOffGuard {
  private readonly controller = new AbortController();
  private readonly cards: string[] = [];
  private armedFor = false;
  private stoppedAt: TurnHandedOff | null = null;

  /** Aborts when the turn is stopped at a hand-off. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** The cards put in front of the person so far this turn. */
  get handedOff(): readonly string[] {
    return this.cards;
  }

  /** Whether the turn was stopped at a hand-off. */
  get stopped(): boolean {
    return this.stoppedAt !== null;
  }

  /** The stop, once it happened. */
  get stopError(): TurnHandedOff | null {
    return this.stoppedAt;
  }

  /**
   * Arm the guard for a person's turn. Unarmed (a mission run, an API token's
   * turn), cards are recorded and nothing is stopped.
   * @param armed - True on a turn a person is waiting on.
   */
  arm(armed: boolean): void {
    this.armedFor = armed;
  }

  /**
   * A card that waits on a person was put up. Call it where the card is
   * emitted.
   * @param label - The card's label, for the log and the error.
   */
  handOff(label: string): void {
    this.cards.push(label);
  }

  /**
   * Another model call is starting: with a card already in front of the
   * person, the turn ends here. Synchronous, so the abort lands before the
   * call's request goes out.
   */
  beforeModelCall(): void {
    if (!this.armedFor || this.cards.length === 0 || this.stoppedAt) {
      return;
    }
    this.stoppedAt = new TurnHandedOff([...this.cards]);
    this.controller.abort(this.stoppedAt);
  }
}

/**
 * Tells a {@link HandOffGuard} a model call is starting, for an in-process
 * LangGraph turn. `awaitHandlers` keeps LangChain from running it in the
 * background, where the call it should stop could get its request out first.
 */
export class HandOffGateCallback extends BaseCallbackHandler {
  override name = 'HandOffGateCallback';
  override awaitHandlers = true;

  /** @param guard - The turn's guard. */
  constructor(private readonly guard: HandOffGuard) {
    super();
  }

  override async handleChatModelStart(): Promise<void> {
    this.guard.beforeModelCall();
  }

  override async handleLLMStart(): Promise<void> {
    this.guard.beforeModelCall();
  }
}

/**
 * What an event hands to the person, by name — or null when it hands them
 * nothing. An open Decision and an approval gate both do: the turn ends at
 * them. (A card is marked where it is emitted, with its own state rules.)
 * @param event - One event of the turn.
 */
export function handsOff(event: import('./types').AgentEvent): string | null {
  if (event.type === 'decision' && (event.decision.state === 'open' || event.decision.state === 'expired')) {
    return event.decision.question;
  }
  if (event.type === 'hitl_gate') {
    return event.gate.question;
  }
  return null;
}
