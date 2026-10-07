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
 * After a login the person lands back in the conversation with a prepared
 * message ("I connected github. What's next?"). Send it once, so the agent
 * carries on by itself, then take the connect params off the URL so a reload
 * or a re-render never sends it again.
 *
 * The send waits for `ready` (the saved thread has settled), so the message
 * lands in the conversation the login came from. A ref makes it once per page
 * load even if the prompt prop is still present on a later render.
 * @param input - What to send and how to clean up.
 * @param input.prompt - The prepared message, absent when the person did not just connect.
 * @param input.ready - True once the chat session has booted.
 * @param input.send - Sends one user message.
 * @param input.pathname - The current path, for the cleaned URL.
 * @param input.replaceUrl - Replaces the URL without adding a history entry.
 */
export function useSendOnConnectReturn(input: {
  prompt: string | undefined;
  ready: boolean;
  send: (text: string) => Promise<void>;
  pathname: string;
  replaceUrl: (url: string) => void;
}): void {
  const { prompt, ready, send, pathname, replaceUrl } = input;
  const sent = useRef(false);
  useEffect(() => {
    if (!prompt || !ready || sent.current) {
      return;
    }
    sent.current = true;
    void send(prompt);
    replaceUrl(`${pathname}${withoutConnectParams(window.location.search)}`);
  }, [prompt, ready, send, pathname, replaceUrl]);
}
