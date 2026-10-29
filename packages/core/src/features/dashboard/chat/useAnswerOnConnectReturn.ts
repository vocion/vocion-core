'use client';

import type { ConnectReturn } from '@/libs/connect/returnTo';
import type { DecisionAnswer, DecisionView } from '@/libs/decisions/decision';
import { useEffect, useRef } from 'react';
import { offerConnectReturn } from './connectTabHandoff';

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
 * @param input.handedOff - The tab that asked took the outcome; this one can close.
 */
export function useAnswerOnConnectReturn(input: {
  outcome: ConnectReturn | null;
  ready: boolean;
  decisions: readonly DecisionView[];
  answer: (view: DecisionView, answer: DecisionAnswer) => void;
  fail: (message: string) => void;
  pathname: string;
  replaceUrl: (url: string) => void;
  handedOff?: () => void;
}): void {
  const { outcome, ready, decisions, answer, fail, pathname, replaceUrl, handedOff } = input;
  const done = useRef(false);
  useEffect(() => {
    if (!outcome || !ready || done.current) {
      return;
    }
    const step = stepForConnector(decisions, outcome.connector);
    if (!step && decisions.length === 0) {
      // Nothing this thread asked: wait for its Decisions to load; the URL is cleaned either way below.
      return;
    }
    done.current = true;
    replaceUrl(`${pathname}${withoutConnectParams(window.location.search)}`);
    if (!step) {
      return;
    }
    // Opened in its own tab, the tab that asked answers it (`connectTabHandoff.ts`);
    // this one only says so. Unclaimed, it is answered here, as before.
    void offerConnectReturn(outcome).then((claimed) => {
      if (claimed) {
        handedOff?.();
      } else if (outcome.ok) {
        answer(step.view, { kind: 'option', optionIds: [step.optionId] });
      } else {
        fail(`Connecting ${outcome.connector} didn't work (${outcome.reason ?? 'no reason given'}). Try again from the card.`);
      }
    });
  }, [outcome, ready, decisions, answer, fail, pathname, replaceUrl, handedOff]);
}

/**
 * The open sign-in steps and the connector each is for: every option a
 * connect card opened its login with (`connect:<slug>`).
 * @param decisions - What the conversation waits on.
 */
export function openConnectSteps(decisions: readonly DecisionView[]): Array<{ view: DecisionView; optionId: string; connector: string }> {
  return decisions.flatMap(view => view.options
    .filter(o => o.id.startsWith('connect:') && o.id.length > 'connect:'.length)
    .map(o => ({ view, optionId: o.id, connector: o.id.slice('connect:'.length) })));
}

/**
 * CONNECTED BY ANY PATH, THE CARD IS ANSWERED. A sign-in card waits for its
 * connector; when the workspace reads that connector now — signed in from
 * another tab, on the Connectors page, or by a callback that landed after the
 * window closed — the step is answered with its own option, typed, as the
 * return from a login would. Read when the page regains focus and whenever
 * `recheckKey` changes (a reply landed), so the card never contradicts it.
 * @param input - What to watch.
 * @param input.decisions - The open Decisions of this conversation.
 * @param input.answer - Answers a Decision, typed.
 * @param input.status - Reads which connectors are connected now.
 * @param input.recheckKey - Changes when the surface wants them read again; null holds.
 */
export function useAnswerWhenConnected(input: {
  decisions: readonly DecisionView[];
  answer: (view: DecisionView, answer: DecisionAnswer) => void;
  status: (connectors: string[]) => Promise<Array<{ connector: string; connected: boolean }>>;
  recheckKey: string | number | null;
}): void {
  const { decisions, answer, status, recheckKey } = input;
  const latest = useRef({ decisions, answer, status });
  useEffect(() => {
    latest.current = { decisions, answer, status };
  });
  const answered = useRef(new Set<string>());
  const stepsKey = openConnectSteps(decisions).map(s => `${s.view.id}:${s.connector}`).join(',');
  useEffect(() => {
    if (!stepsKey) {
      return;
    }
    let live = true;
    const check = async () => {
      const steps = openConnectSteps(latest.current.decisions).filter(s => !answered.current.has(`${s.view.id}:${s.optionId}`));
      if (steps.length === 0) {
        return;
      }
      let read: Array<{ connector: string; connected: boolean }>;
      try {
        read = await latest.current.status([...new Set(steps.map(s => s.connector))]);
      } catch {
        return;
      }
      const connected = new Set(read.filter(r => r.connected).map(r => r.connector));
      for (const step of steps) {
        const key = `${step.view.id}:${step.optionId}`;
        if (live && connected.has(step.connector) && !answered.current.has(key)) {
          answered.current.add(key);
          latest.current.answer(step.view, { kind: 'option', optionIds: [step.optionId] });
        }
      }
    };
    const onBack = () => {
      if (document.visibilityState === 'visible') {
        void check();
      }
    };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    if (recheckKey !== null) {
      void check();
    }
    return () => {
      live = false;
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, [stepsKey, recheckKey]);
}
