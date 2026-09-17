/**
 * Run a list of jobs a few at a time.
 *
 * Doing N slow things one after another wastes most of the wall clock waiting
 * on the network; doing all N at once earns rate-limit errors and turns into
 * retries, which is slower than either. So: a fixed number of workers pulling
 * from a shared queue.
 *
 * `SourceSyncService` already does this inline with a Set of in-flight
 * promises (`MAX_CONCURRENT_INGESTS`). This is the same idea lifted out, so
 * the eval runner can reuse it and so the behaviour can be tested directly
 * rather than through a sync.
 *
 * Results come back in the order the items were given, never in the order
 * they happened to finish — callers index them against their input.
 *
 * A worker that throws rejects the whole call. Callers that want partial
 * success give the worker its own try/catch and return a value describing the
 * failure, which is what the eval runner does: one broken case must not
 * abandon the other forty-nine.
 */

/** Shared position in the queue. An object so every worker sees one cursor. */
type QueueCursor = { next: number };

/**
 * One worker: take the next index, do the work, repeat until the queue is dry.
 * @param items - The full list being worked through.
 * @param cursor - Shared cursor; each worker claims an index by bumping it.
 * @param worker - What to do with one item.
 * @param results - Output array, written at the item's own index.
 */
async function drainQueue<TItem, TResult>(
  items: TItem[],
  cursor: QueueCursor,
  worker: (item: TItem, index: number) => Promise<TResult>,
  results: TResult[],
): Promise<void> {
  while (true) {
    const index = cursor.next;
    cursor.next += 1;
    if (index >= items.length) {
      return;
    }
    results[index] = await worker(items[index]!, index);
  }
}

/**
 * Map over items with at most `limit` in flight at once.
 * @param items - What to work through.
 * @param limit - How many at a time. Clamped to at least 1.
 * @param worker - Called once per item. Declare it at module level and put
 * whatever it needs on the item, rather than closing over enclosing scope.
 * @returns Results in the same order as `items`.
 */
export async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  limit: number,
  worker: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = Array.from({ length: items.length });
  if (items.length === 0) {
    return results;
  }
  const cursor: QueueCursor = { next: 0 };
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const runners: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    runners.push(drainQueue(items, cursor, worker, results));
  }
  await Promise.all(runners);
  return results;
}
