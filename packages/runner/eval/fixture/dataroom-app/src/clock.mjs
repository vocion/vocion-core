export const DEFAULT_NOW = '2026-10-01T12:00:00.000Z';

/** A clock tests can set and move. */
export function createClock(now = DEFAULT_NOW) {
  let current = new Date(now).toISOString();
  return {
    now: () => current,
    set(value) {
      current = new Date(value).toISOString();
    },
    advanceMinutes(n) {
      current = new Date(new Date(current).getTime() + n * 60000).toISOString();
    },
  };
}
