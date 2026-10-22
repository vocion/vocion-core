const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ESCAPES[c]);
}

export function layout(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><main>${body}</main></body></html>`;
}
