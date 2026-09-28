'use client';

import { useEffect, useState } from 'react';

/**
 * A date in the reader's own calendar — "28 Sep 2026" where they are. The
 * server renders the UTC day (it cannot know the zone), and the browser
 * replaces it after mount. The exact instant stays on `dateTime`, and the
 * drawer beside it prints the full stamp.
 * @param props
 * @param props.at - The moment, as a Date or an ISO string.
 */
export function LocalDate({ at }: { at: Date | string }) {
  const d = typeof at === 'string' ? new Date(at) : at;
  const iso = d.toISOString();
  const [text, setText] = useState(() => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d));
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect */
  useEffect(() => {
    setText(new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)));
  }, [iso]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect */
  return <time dateTime={iso}>{text}</time>;
}
