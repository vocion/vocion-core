import { escapeHtml } from '../lib/html.mjs';

export function mark(testId, label) {
  return `<span class="mark" data-testid="${testId}">${escapeHtml(label)}</span>`;
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function fileType(mimeType) {
  const types = { 'application/pdf': 'PDF', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word' };
  return types[mimeType] || 'File';
}

export function fileSize(bytes) {
  if (bytes >= 1000000) {
    return `${(bytes / 1000000).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
