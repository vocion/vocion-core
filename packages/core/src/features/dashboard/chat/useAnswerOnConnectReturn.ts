'use client';

import type { ConnectReturn } from '@/libs/connect/returnTo';
import type { DecisionAnswer, DecisionView } from '@/libs/decisions/decision';
import { useEffect, useRef } from 'react';

/** The query params the connect callback adds to the URL it sends the person back to. */
const CONNECT_PARAMS = ['connect', 'reason', 'source', 'connector'] as const;

/**
 * The query string with the connect outcome removed and everything else
 * (`conversation`, `preview`) kept.
 * @param search - `window.location.search`.
 * @returns The new query string with its leading `?`, or `''` when nothing is left.
 */
export function withoutConnectParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of CONNECT_PARAMS) {
    params.delete(key);
  }
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/**
 * The setup step a connect answers: the open Decision with an option that
 * opened this connector's login or token form (`escalate.ts` names them
 * `connect:<slug>` and `paste:<slug>`).
 * @param decisions - What the conversation waits on.
 * @param connector - The connector that came back.
 */
export function stepForConnector(decisions: readonly DecisionView[], connector: string): { view: DecisionView; optionId: string } | null {
  for (const view of decisions) {
    const option = view.options.find(o => o.id === `connect:${connector}` || o.id === `paste:${connector}`);
    if (option) {
      return { view, optionId: option.id };
    }
  }
  return null;
}

/**
 * BACK FROM A LOGIN, THE STEP IS ANSWERED — typed. The setup Decision that
 * opened the login is answered with the option the person took, so the agent
 * that asked carries on from a record ("Chose Connect with GitHub"), never
 * from "I connected github" written as the person's words. A login that
 * failed answers nothing: the card says why and stays, to try again.
 *
 * Once per page load, after the thread has settled and what it waits on has
 * been read; then the connect params leave the URL so a reload never repeats it.
 * @param input - What came back and how to answer it.
 * @param input.outcome - How the connect came back; null when this visit is not a connect return.
 * @param input.ready - True once the chat session has booted.
 * @param input.decisions - The open Decisions of this conversation.
 * @param input.answer - Answers a Decision, typed.
 * @param input.fail - Says on the card why the connect failed.
 * @param input.pathname - The current path, for the cleaned URL.
 * @param input.replaceUrl - Replaces the URL without adding a history entry.
 */
export function useAnswerOnConnectReturn(input: {
  outcome: ConnectReturn | null;
  ready: boolean;
  decisions: readonly DecisionView[];
  answer: (view: DecisionView, answer: DecisionAnswer) => void;
  fail: (message: string) => void;
  pathname: string;
  replaceUrl: (url: string) => void;
}): void {
  const { outcome, ready, decisions, answer, fail, pathname, replaceUrl } = input;
  const done = useRef(false);
  useEffect(() => {
    if (!outcome || !ready || done.current) {
      return;
    }
    const step = stepForConnector(decisions, outcome.connector);
    if (!step) {
      // Nothing this thread asked: wait for its Decisions to load; the URL is cleaned either way below.
      if (decisions.length === 0) {
        return;
      }
    } else if (outcome.ok) {
      answer(step.view, { kind: 'option', optionIds: [step.optionId] });
    } else {
      fail(`Connecting ${outcome.connector} didn't work (${outcome.reason ?? 'no reason given'}). Try again from the card.`);
    }
    done.current = true;
    replaceUrl(`${pathname}${withoutConnectParams(window.location.search)}`);
  }, [outcome, ready, decisions, answer, fail, pathname, replaceUrl]);
}
