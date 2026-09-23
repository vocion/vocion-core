/**
 * Anything cached for the length of one sync. The promise is what is stored,
 * so documents in flight together share one build, and a build that fails is
 * evicted so the next document tries again.
 * @param cache - The sync-wide cache from the processor context.
 * @param key - Cache key.
 * @param build - Builds the value on a miss.
 */
export function oncePerSync<T>(cache: Map<string, unknown>, key: string, build: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached as Promise<T>;
  }
  const building = build().catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, building);
  return building;
}
