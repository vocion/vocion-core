'use client';

import type { ConnectReturn } from '@/libs/connect/returnTo';

/**
 * A sign-in opened in its own tab, handed back to the tab that asked.
 *
 * The chat opens a connect flow (`/api/connect/…/start`) in a new tab and
 * keeps its card, marked waiting. The flow ends on the chat page in that new
 * tab; before answering anything there, it offers the outcome on a
 * same-origin channel. A tab that holds the step for that connector claims
 * it and answers it, so the agent carries on where the person asked, and the
 * new tab only says it can be closed. Unclaimed (the asking tab is gone, or
 * the flow ran in the same tab), the landing tab answers as before.
 */

const CHANNEL = 'vocion-connect-return';
const CLAIM_WAIT_MS = 700;
// The landing tab's own card listens too: it must never claim its own offer.
const TAB = Math.random().toString(36).slice(2);

type Message = { kind: 'return'; nonce: string; tab: string; outcome: ConnectReturn } | { kind: 'claim'; nonce: string };

function channel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
}

/**
 * Whether an option's link starts a connect flow.
 * @param href - The option's link.
 */
export function isConnectStart(href: string): boolean {
  return /^\/api\/connect\/[\w-]+\/start(?:\?|$)/.test(href);
}

/**
 * Open a connect flow in a new tab. False when the browser blocked it, so the
 * caller navigates this tab instead.
 * @param href - The start link.
 */
export function openConnectTab(href: string): boolean {
  return window.open(href, '_blank') !== null;
}

/**
 * Listen for a connect that finished in another tab. `take` answers it here
 * and says whether this tab held its step; only then is it claimed.
 * @param take - Handles the outcome; true when this tab answered it.
 * @returns Stop listening.
 */
export function listenForConnectReturn(take: (outcome: ConnectReturn) => boolean): () => void {
  const ch = channel();
  if (!ch) {
    return () => undefined;
  }
  ch.onmessage = (event: MessageEvent<Message>) => {
    const msg = event.data;
    if (msg?.kind === 'return' && msg.tab !== TAB && take(msg.outcome)) {
      ch.postMessage({ kind: 'claim', nonce: msg.nonce } satisfies Message);
    }
  };
  return () => ch.close();
}

/**
 * Offer a connect outcome to the tab that asked for it.
 * @param outcome - How the connect came back.
 * @returns True when another tab claimed and answered it.
 */
export function offerConnectReturn(outcome: ConnectReturn): Promise<boolean> {
  const ch = channel();
  if (!ch) {
    return Promise.resolve(false);
  }
  const nonce = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ch.close();
      resolve(false);
    }, CLAIM_WAIT_MS);
    ch.onmessage = (event: MessageEvent<Message>) => {
      if (event.data?.kind === 'claim' && event.data.nonce === nonce) {
        clearTimeout(timer);
        ch.close();
        resolve(true);
      }
    };
    ch.postMessage({ kind: 'return', nonce, tab: TAB, outcome } satisfies Message);
  });
}
