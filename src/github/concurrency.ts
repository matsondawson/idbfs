/**
 * Runs `fn` over `items` with at most `limit` in flight at once, preserving result order.
 *
 * Once any call throws, no *new* items are started — e.g. a rate-limit error
 * shouldn't spend the rest of an already-exhausted quota on doomed requests.
 * Items already in flight when that happens are left to settle on their own
 * (there's no cancellation), but their errors are swallowed rather than left
 * as unhandled rejections; only the first error is thrown, once every worker
 * has stopped.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let nextIndex = 0;
  let done = 0;
  let firstError: unknown;
  let failed = false;

  async function worker(): Promise<void> {
    while (nextIndex < items.length && !failed) {
      const i = nextIndex++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        if (!failed) {
          failed = true;
          firstError = e;
        }
        return;
      }
      done++;
      onProgress?.(done, items.length);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failed) throw firstError;
  return results;
}
