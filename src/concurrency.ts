export const mapConcurrent = async <T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await worker(values[index]!);
      }
    }),
  );
  return results;
};

export const mapConcurrentAfterDistinctKeyProbes = async <T, R>(
  values: readonly T[],
  limit: number,
  keyFor: (value: T) => string,
  worker: (value: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  const seen = new Set<string>();
  const probes: Array<{ index: number; value: T }> = [];
  const remaining: Array<{ index: number; value: T }> = [];
  values.forEach((value, index) => {
    const key = keyFor(value);
    const destination = seen.has(key) ? remaining : probes;
    seen.add(key);
    destination.push({ index, value });
  });
  const run = (items: ReadonlyArray<{ index: number; value: T }>) =>
    mapConcurrent(items, limit, async ({ index, value }) => {
      const result = await worker(value);
      results[index] = result;
    });
  await run(probes);
  await run(remaining);
  return results;
};
