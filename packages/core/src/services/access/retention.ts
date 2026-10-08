/**
 * How long the access log keeps a read — `VOCION_ACCESS_LOG_RETENTION_DAYS`.
 *
 * Its own module, with nothing but the environment behind it, because the
 * deployment schedule list reads it at boot and must not pull the database in
 * to decide whether a prune is wanted.
 */

import process from 'node:process';

/** How long reads are kept when nothing says otherwise. */
export const DEFAULT_ACCESS_LOG_RETENTION_DAYS = 365;

/** The longest retention that can be set: a century, far below where a date stops being representable. */
export const MAX_ACCESS_LOG_RETENTION_DAYS = 36_500;

/**
 * Days of reads to keep, or null to keep them all.
 *
 * Unset means a year. `0` keeps every row. Anything that is not a whole
 * number of days, or is more than {@link MAX_ACCESS_LOG_RETENTION_DAYS}, is
 * logged and read as the default — a typo in an env file must not turn
 * retention off, must not hand the prune a date it cannot represent, and must
 * not stop a deploy either.
 * @param raw - The variable's value (read from the environment by default).
 */
export function accessLogRetentionDays(raw: string | undefined = process.env.VOCION_ACCESS_LOG_RETENTION_DAYS): number | null {
  const value = raw?.trim();
  if (!value) {
    return DEFAULT_ACCESS_LOG_RETENTION_DAYS;
  }
  if (!/^\d+$/.test(value)) {
    console.warn(`[access-log] VOCION_ACCESS_LOG_RETENTION_DAYS must be a whole number of days (0 keeps everything); got "${value}", keeping ${DEFAULT_ACCESS_LOG_RETENTION_DAYS}.`);
    return DEFAULT_ACCESS_LOG_RETENTION_DAYS;
  }
  const days = Number(value);
  if (days > MAX_ACCESS_LOG_RETENTION_DAYS) {
    console.warn(`[access-log] VOCION_ACCESS_LOG_RETENTION_DAYS is at most ${MAX_ACCESS_LOG_RETENTION_DAYS} days (0 keeps everything); got "${value}", keeping ${DEFAULT_ACCESS_LOG_RETENTION_DAYS}.`);
    return DEFAULT_ACCESS_LOG_RETENTION_DAYS;
  }
  return days === 0 ? null : days;
}
