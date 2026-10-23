import { escapeHtml, layout } from '../lib/html.mjs';
import { isoMinute } from '../lib/time.mjs';
import { plural } from './components.mjs';

export function analyticsPage({ doc, activity }) {
  const rows = activity.map(a => `<tr data-testid="activity-row" data-id="${a.linkId}"><td data-testid="recipient">${escapeHtml(a.recipientEmail)}</td><td data-testid="opens">${plural(a.opens, 'open')}</td><td data-testid="last-opened">${a.lastOpenedAt ? isoMinute(a.lastOpenedAt) : 'Never'}</td></tr>`).join('');
  return layout(`${doc.title}: activity`, `<h1 data-testid="title">${escapeHtml(doc.title)}</h1><table data-testid="activity"><thead><tr><th>Recipient</th><th>Opens</th><th>Last opened (UTC)</th></tr></thead><tbody>${rows}</tbody></table>`);
}
