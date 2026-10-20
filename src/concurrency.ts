export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const size = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index] as T;
      results[index] = await mapper(item, index);
    }
  }

  await Promise.all(Array.from({ length: size }, () => worker()));
  return results;
}
