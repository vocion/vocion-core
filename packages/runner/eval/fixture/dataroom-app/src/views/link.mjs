import { escapeHtml, layout } from '../lib/html.mjs';
import { formatDay } from '../lib/time.mjs';

/** What a visitor sees: the passcode prompt, or the document. */
export function linkPage({ state, link, doc, sharedBy }) {
  if (state === 'passcode' || state === 'wrong_passcode') {
    const error = state === 'wrong_passcode' ? '<p data-testid="passcode-error">That passcode is not right.</p>' : '';
    return layout('Passcode required', `<h1>This document is protected</h1>${error}<form data-testid="passcode-form" method="get" action="/l/${link.id}"><input name="passcode" type="password" aria-label="Passcode"><button>Open</button></form>`);
  }
  const download = link.allowDownload === false ? '' : `<a data-testid="download" href="/l/${link.id}/download">Download</a>`;
  return layout(doc.title, `<h1 data-testid="title">${escapeHtml(doc.title)}</h1><p data-testid="shared-by">Shared by ${escapeHtml(sharedBy?.name || 'a Northwind Dataroom user')} on ${formatDay(link.createdAt)}</p><div data-testid="viewer">${doc.pageCount} pages</div>${download}`);
}
