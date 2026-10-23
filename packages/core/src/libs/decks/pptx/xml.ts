/**
 * A small order-preserving XML reader for the OOXML parts the adapters read
 * (PPTX slides and notes, DOCX document.xml). Namespaced tag names are kept
 * as written (`a:p`, `w:p`); attribute names lose fast-xml-parser's prefix.
 */

import { XMLParser } from 'fast-xml-parser';

export type XNode = { tag: string; attrs: Record<string, string>; kids: XNode[]; text?: string };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

function convert(arr: Array<Record<string, unknown>>): XNode[] {
  const out: XNode[] = [];
  for (const item of arr) {
    const key = Object.keys(item).find(k => k !== ':@');
    if (!key) {
      continue;
    }
    if (key === '#text') {
      out.push({ tag: '#text', attrs: {}, kids: [], text: String(item[key]) });
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries((item[':@'] as Record<string, string> | undefined) ?? {})) {
      attrs[k.replace(/^@_/, '')] = String(v);
    }
    out.push({ tag: key, attrs, kids: convert(item[key] as Array<Record<string, unknown>>) });
  }
  return out;
}

export function parseXml(xml: string): XNode[] {
  return convert(parser.parse(xml) as Array<Record<string, unknown>>);
}

export const child = (n: XNode | undefined, tag: string) => n?.kids.find(k => k.tag === tag);
export const childrenOf = (n: XNode | undefined, tag: string) => n?.kids.filter(k => k.tag === tag) ?? [];
export function descendants(n: XNode, tag: string, out: XNode[] = []): XNode[] {
  for (const k of n.kids) {
    if (k.tag === tag) {
      out.push(k);
    }
    descendants(k, tag, out);
  }
  return out;
}
export const textContent = (n: XNode): string => (n.tag === '#text' ? (n.text ?? '').replaceAll('\r', '') : n.kids.map(textContent).join(''));
