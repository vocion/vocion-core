import { escapeHtml, layout } from '../lib/html.mjs';
import { format } from '../lib/legacyDate.mjs';
import { fileSize, fileType, mark, plural } from './components.mjs';

export function documentPage({ doc, links }) {
  const rows = links.map((l) => {
    const marks = `${l.passcodeHash ? mark('mark-passcode', 'Passcode') : ''}${l.allowDownload === false ? mark('mark-no-download', 'No download') : ''}`;
    return `<li data-testid="link-row" data-id="${l.id}"><span data-testid="recipient">${escapeHtml(l.recipientEmail)}</span> <span data-testid="link-created">${format(l.createdAt, 'MMM D')}</span> ${marks}</li>`;
  }).join('');
  const meta = `${plural(doc.pageCount, 'page')} · ${fileType(doc.mimeType)} · ${fileSize(doc.sizeBytes)} · uploaded ${format(doc.uploadedAt, 'MMM D, YYYY')}`;
  return layout(doc.title, `<a data-testid="back" href="/">Library</a><h1 data-testid="title">${escapeHtml(doc.title)}</h1><p data-testid="doc-meta">${meta}</p><section data-testid="links"><h2>Links</h2><ul>${rows}</ul></section><a data-testid="analytics-link" href="/documents/${doc.id}/analytics">Activity</a>`);
}
