/**
 * A release's announcement as rich text, for the Copy that publishes it when
 * the workspace has no Slack connection: the picture first, then the words —
 * the order the release page shows them — so what is pasted into an email, a
 * doc or a chat reads the way it was approved. Pure and client-safe.
 */

/**
 * Escape text for HTML.
 * @param text - Plain text.
 */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The announcement as HTML: the picture (a data URL, so it survives the paste
 * into a place that cannot sign in to Vocion), then each paragraph.
 * @param input - What to copy.
 * @param input.text - The approved words.
 * @param input.title - The release's title, the picture's alt text.
 * @param input.imageSrc - The picture as a data URL, or its URL when its bytes could not be read; null when there is none.
 */
export function announcementHtml(input: { text: string; title: string; imageSrc: string | null }): string {
  const paragraphs = input.text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`);
  const image = input.imageSrc ? `<p><img src="${esc(input.imageSrc)}" alt="${esc(input.title)}" style="max-width:100%;height:auto"></p>` : '';
  return `${image}${paragraphs.join('')}`;
}

/**
 * The filename the picture downloads as: the release's title, made safe.
 * @param title - The release's title.
 * @param contentType - The picture's type, for its extension.
 */
export function announcementImageFilename(title: string, contentType: string | null): string {
  const ext = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/webp' ? 'webp' : contentType === 'image/gif' ? 'gif' : 'png';
  const base = title.normalize('NFKD').replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 80) || 'release';
  return `${base}.${ext}`;
}
