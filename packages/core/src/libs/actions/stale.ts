/**
 * The one way an action's `execute` says "what this was approved on is no
 * longer true" at the moment it runs: throw a `StaleError` with the finding.
 * `ActionService.executeAction` puts the run back in Review with the line,
 * exactly as a stale `stillHolds` at approval would, instead of recording a
 * failure. For a condition only the write itself sees (a sequence the
 * contact joined between the check and the enrollment).
 */

import type { StaleFinding } from './types';

export class StaleError extends Error {
  finding: StaleFinding;
  constructor(finding: StaleFinding) {
    super(finding.line);
    this.name = 'StaleError';
    this.finding = finding;
  }
}

export function isStaleError(err: unknown): err is StaleError {
  return err instanceof StaleError || (err instanceof Error && err.name === 'StaleError' && typeof (err as StaleError).finding?.line === 'string');
}
