/**
 * Post-process the LLM's raw output before it lands in the review queue.
 *
 * When a skill folder contains a `scriptFile:` reference in skill.yaml,
 * the runtime imports this module and calls the default export as:
 *
 *     postprocess(output, input, ctx) → string | object
 *
 * Return value replaces the skill's output. Throw to fail the run.
 *
 * Use this for cheap, deterministic cleanup the LLM shouldn't be trusted
 * to do reliably — trim preambles, normalize whitespace, redact PII,
 * enforce character limits. Heavier logic (multi-pass LLM, external API
 * calls) belongs in a real plugin via @vocion/sdk.
 *
 * Contract:
 *   - Pure function — no network calls, no file I/O
 *   - Idempotent — postprocess(postprocess(x)) === postprocess(x)
 *   - Fast — runs on every invocation, budget ~10ms
 */

const PREAMBLE_PATTERNS = [
  /^sure[,!]?\s+here[^\n]*\n+/i,
  /^here'?s?\s+(?:\S[^\n]*)?\n+/i,
  /^i'?ll\s+draft[^\n]*\n+/i,
  /^certainly[,!]?\s*\n/i,
];

const SIGN_OFF_BOILERPLATE = [
  /\n\s*best\s+regards,?\s*\n\[your name\]\s*$/i,
  /\n\s*let me know[^\n]*\n\s*[-–—]+\s*$/i,
];

export default function postprocess(output, _input, _ctx) {
  if (typeof output !== 'string') {
    return output;
  }
  let cleaned = output;

  // Strip common LLM preambles: "Sure, here's a draft...", "Certainly!", etc.
  for (const rx of PREAMBLE_PATTERNS) {
    cleaned = cleaned.replace(rx, '');
  }

  // Strip trailing boilerplate sign-offs the model added unprompted.
  for (const rx of SIGN_OFF_BOILERPLATE) {
    cleaned = cleaned.replace(rx, '');
  }

  // Normalize whitespace — collapse 3+ newlines to 2, trim edges.
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}
