export async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length);
    const size = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
    let cursor = 0;
    async function worker() {
        while (cursor < items.length) {
            const index = cursor++;
            const item = items[index];
            results[index] = await mapper(item, index);
        }
    }
    await Promise.all(Array.from({ length: size }, () => worker()));
    return results;
}
//# sourceMappingURL=concurrency.js.map