'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { CONNECT_DONE_MESSAGE, outcomeOfSearch, reasonInWords } from './loginWindow';

/**
 * The login window's last page: post the outcome to the opener, then close.
 * Nothing but the short outcome code crosses — the query the callback wrote.
 */
export function ConnectDone() {
  const [outcome, setOutcome] = useState<ReturnType<typeof outcomeOfSearch>>(null);
  useEffect(() => {
    const search = window.location.search;
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect -- read once from the address on mount
    setOutcome(outcomeOfSearch(search));
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: CONNECT_DONE_MESSAGE, search }, window.location.origin);
      window.close();
    }
  }, []);
  return (
    <main className="mx-auto max-w-sm px-6 py-16 text-center" data-testid="connect-done">
      <h1 className="text-lg font-semibold tracking-tight">{outcome?.ok === false ? 'Not connected' : 'Connected'}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {outcome?.ok === false ? reasonInWords(outcome.reason) : 'You can close this window and carry on in the conversation.'}
      </p>
      <Link href="/dashboard/chat" className="mt-6 inline-block text-sm font-medium underline-offset-4 hover:underline">Back to the conversation</Link>
    </main>
  );
}
