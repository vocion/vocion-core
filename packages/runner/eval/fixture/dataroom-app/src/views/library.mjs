import { escapeHtml, layout } from '../lib/html.mjs';
import { format } from '../lib/legacyDate.mjs';
import { fileType, mark, plural } from './components.mjs';

function activity(s) {
  if (!s || s.opens === 0) {
    return '<span data-testid="activity">Not opened yet</span>';
  }
  return `<span data-testid="activity">Opened ${plural(s.opens, 'time')}</span> <span data-testid="opened-by">Opened by ${s.openedBy}</span>`;
}

/** The library list. `stats` is analytics.documentStats for these documents. */
export function libraryPage({ library, documents, stats, q = '' }) {
  const rows = documents.map(d => `<li data-testid="doc-row" data-id="${d.id}"><a class="title" href="/documents/${d.id}">${escapeHtml(d.title)}</a><div class="meta"><span data-testid="uploaded">${format(d.uploadedAt, 'MMM D, YYYY')}</span> · <span data-testid="pages">${plural(d.pageCount, 'page')}</span> · <span data-testid="type">${fileType(d.mimeType)}</span>${d.archivedAt ? ` ${mark('mark-archived', 'Archived')}` : ''}</div><div class="activity">${activity(stats[d.id])}</div></li>`).join('');
  const search = `<form data-testid="search" action="/" method="get"><input name="q" value="${escapeHtml(q)}" aria-label="Search"></form>`;
  const empty = documents.length ? '' : `<p data-testid="empty">${q ? 'No documents match your search.' : 'No documents yet.'}</p>`;
  return layout(library.name, `<h1 data-testid="library-name">${escapeHtml(library.name)}</h1>${search}<p data-testid="count">${plural(documents.length, 'document')}</p><ul data-testid="documents">${rows}</ul>${empty}`);
}
