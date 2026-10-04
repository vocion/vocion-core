/**
 * THE GATE A TOOL CALL WAITS AT — what lets a turn's model start before
 * everything about the turn is known.
 *
 * A chat turn used to wait for two small model reads before its main model
 * said a word: who answers a thread's first turn (`router.ts`), and what the
 * person wants (`turnJudge.readIntent`). Neither changes what the model reads;
 * both change what it may DO. So the model starts at once and every tool call
 * — a subagent's included, since the callback rides the run's config — waits
 * here until both are settled. A turn that was started early for an agent the
 * router then did not pick throws {@link HeadStartDropped} at its first tool,
 * and its signal has already stopped the model.
 */
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

/** A head start for an agent the router did not pick: the turn is dropped, never answered. */
export class HeadStartDropped extends Error {
  constructor() {
    super('the turn was started early for an agent the router did not pick');
    this.name = 'HeadStartDropped';
  }
}

/** Holds every tool call of a turn until `ready` resolves; a throw fails the call. */
export class TurnGateCallback extends BaseCallbackHandler {
  override name = 'TurnGateCallback';
  override awaitHandlers = true;
  override raiseError = true;

  /** @param ready - Resolves when the turn's tools may run; throws when they may not. */
  constructor(private readonly ready: () => Promise<void>) {
    super();
  }

  override async handleToolStart(): Promise<void> {
    await this.ready();
  }
}
