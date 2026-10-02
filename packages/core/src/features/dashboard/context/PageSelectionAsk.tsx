'use client';

import { AskAboutThis } from './AskAboutThis';
import { usePageRecord } from './PageContextProvider';

/**
 * SELECT TO ASK, ON EVERY PAGE (Chris, 2026-09-29, on release #223: "why don't
 * I get chat with/ask tooltip … That should be core functionality on EVERY
 * generated page"). The feature page offered Ask and Change on highlighted
 * text because it mounted the toolbar itself; the release page did not, and
 * nor did any page that forgot. Mounted once in the shell over the page
 * content: **Ask** everywhere, with the page's record when it declares one
 * (`RecordContext`) and the page itself when it does not; **Change** when the
 * page is a record the agent can write. A region with its own toolbar (a
 * record body, the feature report) keeps it — this yields there.
 */
export function PageSelectionAsk() {
  const { record } = usePageRecord();
  return (
    <AskAboutThis
      record={record}
      selectionRoot="[data-page-content]"
      variant="none"
      changeable={record?.type === 'object' || record?.type === 'request'}
      pageWide
    />
  );
}
