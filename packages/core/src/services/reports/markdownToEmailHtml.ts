/**
 * A deliberately small markdown → HTML step for email bodies.
 *
 * Briefings are agent-written markdown: headings, paragraphs, bullet and
 * numbered lists, bold/italic/code, links, tables, horizontal rules. That is
 * the whole grammar handled here. Everything is HTML-escaped first, so agent
 * text can never inject markup into the mail; inline styles are applied by
 * the caller's style map so the output survives clients that strip <style>.
 *
 * Not a general markdown engine and not meant to become one — `react-markdown`
 * renders the same content in the dashboard. This exists because email needs
 * a string, server-side, with no React tree.
 */

export type EmailStyles = {
  h1: string;
  h2: string;
  h3: string;
  p: string;
  ul: string;
  ol: string;
  li: string;
  a: string;
  code: string;
  hr: string;
  table: string;
  th: string;
  td: string;
  blockquote: string;
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only http(s) and mailto survive; anything else renders as plain text.
 * @param href - Raw link target from the markdown.
 */
function safeHref(href: string): string | null {
  const h = href.trim();
  return /^(?:https?:\/\/|mailto:)/i.test(h) ? h : null;
}

/**
 * Inline: code, bold, italic, links — applied to already-escaped text.
 * @param escaped - HTML-escaped source text.
 * @param st - Inline styles for links and code.
 */
export function renderInline(escaped: string, st: Pick<EmailStyles, 'a' | 'code'>): string {
  let out = escaped;
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code style="${st.code}">${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) => {
    // href was escaped with the rest of the line; undo the entity escapes that
    // legitimately occur in URLs before validating.
    const raw = href.replace(/&amp;/g, '&');
    const ok = safeHref(raw);
    return ok ? `<a href="${escapeHtml(ok)}" style="${st.a}">${text}</a>` : `${text} (${href})`;
  });
  return out;
}

type Block
  = | { t: 'h'; level: 1 | 2 | 3; text: string }
    | { t: 'p'; text: string }
    | { t: 'ul' | 'ol'; items: string[] }
    | { t: 'hr' }
    | { t: 'quote'; text: string }
    | { t: 'table'; head: string[]; rows: string[][] };

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

function isTableSeparator(line: string): boolean {
  if (!line.includes('-')) {
    return false;
  }
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every(c => /^:?-{3,}:?$/.test(c));
}

/**
 * Group lines into blocks. Fenced code is treated as a preformatted paragraph.
 * @param markdown - Source text.
 */
export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  const flushPara = (buf: string[]) => {
    if (buf.length > 0) {
      blocks.push({ t: 'p', text: buf.join(' ') });
      buf.length = 0;
    }
  };
  const para: string[] = [];
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === '') {
      flushPara(para);
      i += 1;
      continue;
    }
    if (trimmed.startsWith('```')) {
      flushPara(para);
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        code.push(lines[i]!);
        i += 1;
      }
      i += 1;
      blocks.push({ t: 'quote', text: code.join('\n') });
      continue;
    }
    const h = /^(#{1,3})\s+(\S.*)$/.exec(trimmed);
    if (h) {
      flushPara(para);
      blocks.push({ t: 'h', level: h[1]!.length as 1 | 2 | 3, text: h[2]! });
      i += 1;
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara(para);
      blocks.push({ t: 'hr' });
      i += 1;
      continue;
    }
    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      flushPara(para);
      const head = splitTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i]!));
        i += 1;
      }
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      flushPara(para);
      const ordered = /^\d+[.)]\s+/.test(trimmed);
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i]!.trim();
        const m = ordered ? /^\d+[.)]\s+(\S.*)$/.exec(l) : /^[-*+]\s+(\S.*)$/.exec(l);
        if (m) {
          items.push(m[1]!);
          i += 1;
        } else if (l !== '' && /^\s{2,}/.test(lines[i]!) && items.length > 0) {
          // continuation line of the previous item
          items[items.length - 1] = `${items[items.length - 1]} ${l}`;
          i += 1;
        } else {
          break;
        }
      }
      blocks.push({ t: ordered ? 'ol' : 'ul', items });
      continue;
    }
    if (trimmed.startsWith('>')) {
      flushPara(para);
      const q: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        q.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ t: 'quote', text: q.join(' ') });
      continue;
    }
    para.push(trimmed);
    i += 1;
  }
  flushPara(para);
  return blocks;
}

/**
 * Render markdown to inline-styled HTML for mail.
 * @param markdown - Source text (agent-written, untrusted).
 * @param st - Inline style map.
 */
/**
 * Render markdown to inline-styled HTML for mail.
 * @param markdown - Source text (agent-written, untrusted).
 * @param st - Inline style map.
 */
export function markdownToEmailHtml(markdown: string, st: EmailStyles): string {
  const inline = (raw: string) => renderInline(escapeHtml(raw), st);
  return parseBlocks(markdown).map((b) => {
    switch (b.t) {
      case 'h': {
        const tag = `h${b.level}` as 'h1' | 'h2' | 'h3';
        return `<${tag} style="${st[tag]}">${inline(b.text)}</${tag}>`;
      }
      case 'p':
        return `<p style="${st.p}">${inline(b.text)}</p>`;
      case 'ul':
      case 'ol':
        return `<${b.t} style="${st[b.t]}">${b.items.map(it => `<li style="${st.li}">${inline(it)}</li>`).join('')}</${b.t}>`;
      case 'hr':
        return `<hr style="${st.hr}">`;
      case 'quote':
        return `<blockquote style="${st.blockquote}">${escapeHtml(b.text).replace(/\n/g, '<br>')}</blockquote>`;
      case 'table': {
        const head = `<tr>${b.head.map(c => `<th style="${st.th}">${inline(c)}</th>`).join('')}</tr>`;
        const rows = b.rows.map(r => `<tr>${r.map(c => `<td style="${st.td}">${inline(c)}</td>`).join('')}</tr>`).join('');
        return `<table role="presentation" cellpadding="0" cellspacing="0" style="${st.table}">${head}${rows}</table>`;
      }
      default:
        return '';
    }
  }).join('\n');
}

/**
 * Markdown → readable plain text for the `text/plain` alternative.
 * @param markdown - Source text.
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, m => m.replace(/```/g, '').trim())
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/^[ \t]*[-*+]\s+/gm, '• ')
    .replace(/^[ \t]*(?:\|[ \t]*)?:?-{3}.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
