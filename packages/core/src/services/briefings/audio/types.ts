/**
 * A brief read aloud, as stored on its briefing row (`briefing.audio`) and as
 * the player reads it. Pure and client-safe: the player, the schema and the
 * services share these words.
 */

/** The speeds the player offers, and a person's default is one of them. */
export const LISTEN_SPEEDS = [1, 1.5, 2] as const;
export type ListenSpeed = typeof LISTEN_SPEEDS[number];

/**
 * What a brief's audio is now:
 *   - `pending` — being made (the script, then the voice); `at` says since when;
 *   - `ready` — kept in the media store, with what made it;
 *   - `failed` — could not be made this time, and why, in a sentence.
 * `sourceHash` keys every state to what was spoken from (the brief's words,
 * the voice and the model): a brief refreshed in place no longer matches, so
 * it is spoken again.
 */
export type BriefAudio
  = | { status: 'pending'; sourceHash: string; at: string }
    | {
      status: 'ready';
      sourceHash: string;
      at: string;
      /** The media store's URL (`/api/media/<record>/<file>`); served to readers through `/api/briefings/<id>/audio`. */
      url: string;
      filename: string;
      bytes: number;
      durationMs: number;
      /** What was said: the spoken script, kept so the audio is traceable to words (principle 10). */
      script: string;
      voice: { connector: string; id: string; name: string | null };
      model: string;
      characters: number;
      /** The estimate charged for the voice, in micro-cents (the script's model call charges on its own). */
      costMicroCents: number;
    }
    | { status: 'failed'; sourceHash: string; at: string; reason: string };

/** What the player is told about one brief's audio. */
export type BriefAudioState
  = | { status: 'off'; reason: string }
    | { status: 'pending' }
    | { status: 'ready'; src: string; durationMs: number; speed: ListenSpeed; title: string }
    | { status: 'failed'; reason: string };

/**
 * A duration as a person reads it on a button: `2:14`.
 * @param ms - Milliseconds.
 */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * A stored speed as one the player offers (nearest; 1 when unknown).
 * @param n - The stored number.
 */
export function asListenSpeed(n: number | null | undefined): ListenSpeed {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return 1;
  }
  return LISTEN_SPEEDS.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), 1 as ListenSpeed);
}
