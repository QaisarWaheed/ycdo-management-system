/**
 * Like Promise.all(items.map(fn)) but runs at most `size` calls at once, so a
 * long list does not open one DB query per row simultaneously and exhaust the
 * Prisma connection pool (which surfaces as intermittent 500s).
 */
export async function mapInBatches<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  size = 5,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return results;
}
