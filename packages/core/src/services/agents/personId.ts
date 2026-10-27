/**
 * The person a turn is for, or null for the stand-ins non-person callers pass
 * as a user (`system`, `eval-runner`, `workflow:<slug>:<run>`, `mission:…`,
 * `automation:<slug>`, `token:<id>`).
 * @param userId - What the caller passed.
 */
export function personIdOf(userId: string | null | undefined): string | null {
  if (!userId || userId === 'system' || userId === 'eval-runner' || userId.includes(':')) {
    return null;
  }
  return userId;
}
