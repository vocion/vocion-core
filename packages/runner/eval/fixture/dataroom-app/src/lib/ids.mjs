/** Ids that are short, readable and the same on every run: prefix and a counter per app. */
export function createIds(start = {}) {
  const counters = { ...start };
  return {
    next(prefix) {
      counters[prefix] = (counters[prefix] || 0) + 1;
      return `${prefix}_${String(counters[prefix]).padStart(4, '0')}`;
    },
  };
}
