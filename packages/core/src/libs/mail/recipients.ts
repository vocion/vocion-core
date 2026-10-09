/**
 * Recipient lists as people write them — `a@x.example, "Reyes, Dana"
 * <d@y.example>` — split and named the same way on the server (the Gmail
 * action) and in the browser (the outbound artifact's chips). Pure.
 */

/**
 * The entries of a comma-separated recipient header, splitting only on
 * commas outside quotes and angle brackets.
 * @param value - The header value.
 */
export function splitRecipients(value: string | undefined): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  let angled = false;
  for (const ch of value ?? '') {
    if (ch === '"' && !angled) {
      quoted = !quoted;
    } else if (ch === '<' && !quoted) {
      angled = true;
    } else if (ch === '>' && !quoted) {
      angled = false;
    }
    if (ch === ',' && !quoted && !angled) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map(s => s.trim()).filter(Boolean);
}

/**
 * The person's name in a header value, or null when it carries only an address.
 * @param header - `Dana Reyes <dana@kestrel.example>`, `"Reyes, Dana" <…>` or `dana@…`.
 */
export function nameOf(header: string): string | null {
  const open = header.indexOf('<');
  if (open <= 0 || !header.trimEnd().endsWith('>')) {
    return null;
  }
  const name = header.slice(0, open).trim().replace(/^"/, '').replace(/"$/, '').trim();
  if (!name || name.includes('@')) {
    return null;
  }
  // "Reyes, Dana" reads as "Dana Reyes".
  const comma = name.indexOf(',');
  return comma > 0 ? `${name.slice(comma + 1).trim()} ${name.slice(0, comma).trim()}` : name;
}

/**
 * The address in a header value: `Dana Reyes <dana@x>` → `dana@x`.
 * @param header - The value.
 */
export function addressIn(header: string): string {
  return (/<([^>]+)>/.exec(header)?.[1] ?? header).trim();
}
