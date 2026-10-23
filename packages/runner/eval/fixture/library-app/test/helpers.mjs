// The visible text of an HTML string, tags removed and spaces collapsed.
export function text(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

// The HTML of each element carrying data-testid="<id>", in order.
export function byTestId(html, id) {
  const out = [];
  const re = new RegExp(`<(\\w+)[^>]*data-testid="${id}"[^>]*>`, 'g');
  let m = re.exec(html);
  while (m) {
    const tag = m[1];
    const close = html.indexOf(`</${tag}>`, m.index);
    out.push(close === -1 ? m[0] : html.slice(m.index, close + tag.length + 3));
    m = re.exec(html);
  }
  return out;
}
