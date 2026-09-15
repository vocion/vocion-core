/**
 * How a piece of evidence names its kind and its source. A fact and an
 * inference are not the same thing, so the chip says which, in one of two
 * words, whatever vocabulary the researcher used ('fact', 'company',
 * 'engagement', 'signal' are all facts; 'inference', 'hypothesis', 'guess'
 * are all inferences). Anything else is shown as written, so a new kind is
 * visible rather than silently filed.
 */

export type EvidenceSource = {
  /** The chip's word. */
  label: 'Fact' | 'Inference' | (string & {});
  tone: 'fact' | 'inference' | 'other';
};

const FACT_KINDS = new Set(['fact', 'facts', 'company', 'engagement', 'signal', 'crm', 'observed', 'quote']);
const INFERENCE_KINDS = new Set(['inference', 'inferred', 'hypothesis', 'guess', 'assumption', 'likely']);

/**
 * @param kind - The kind string the researcher recorded on the claim.
 */
export function evidenceSource(kind: string | null | undefined): EvidenceSource {
  const k = (kind ?? '').trim().toLowerCase();
  if (k === '') {
    return { label: 'Fact', tone: 'fact' };
  }
  if (FACT_KINDS.has(k)) {
    return { label: 'Fact', tone: 'fact' };
  }
  if (INFERENCE_KINDS.has(k)) {
    return { label: 'Inference', tone: 'inference' };
  }
  return { label: k.charAt(0).toUpperCase() + k.slice(1), tone: 'other' };
}

/**
 * The citation suffix: a URL reads as its host and path, a `hubspot:…` ref
 * as `HubSpot`, anything else as written.
 * @param source - The claim's source string.
 */
export function citationLabel(source: string): string {
  if (/^https?:\/\//i.test(source)) {
    try {
      const u = new URL(source);
      const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
      return `${u.hostname.replace(/^www\./, '')}${path}`;
    } catch {
      return source;
    }
  }
  const m = /^([a-z][a-z0-9-]*):(.+)$/i.exec(source);
  if (m) {
    const system = m[1]!;
    return `${system.charAt(0).toUpperCase()}${system.slice(1)} · ${m[2]}`;
  }
  return source;
}

/**
 * @param source - The claim's source string.
 */
export function isCitationUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}
