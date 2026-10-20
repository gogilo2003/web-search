import { mapWithConcurrency } from "./concurrency.js";
import { search } from "./duckduckgo.js";
import { fetchPageDetails } from "./extract.js";
import { storeReport } from "./store.js";
const DEFAULT_FOLLOW = 5;
const DEFAULT_MAX_CHARS = 4_000;
const DEFAULT_CONCURRENCY = 5;
function withoutHtml(page) {
    if (!("html" in page))
        return page;
    const { html: _html, ...details } = page;
    return details;
}
export async function runSearchReport(query, options = {}) {
    const response = await search(query, {
        limit: options.limit,
        timeoutMs: options.timeoutMs,
    });
    const follow = options.followLinks === false
        ? 0
        : Math.min(response.results.length, Math.max(0, Math.floor(options.follow ?? DEFAULT_FOLLOW)));
    const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    const timeoutMs = options.timeoutMs;
    const rawHtml = options.rawHtml ?? false;
    const pages = new Array(follow);
    const followed = await mapWithConcurrency(response.results.slice(0, follow), concurrency, async (result, index) => {
        const page = await fetchPageDetails(result.url, {
            timeoutMs,
            maxChars,
            includeHtml: rawHtml,
        });
        pages[index] = page;
        return { ...result, details: withoutHtml(page) };
    });
    const results = response.results.map((result, index) => (index < follow ? followed[index] : result));
    const report = {
        query: response.query,
        searchedAt: new Date().toISOString(),
        instantAnswer: response.instantAnswer,
        results,
    };
    if (options.save) {
        report.storage = await storeReport(report, pages, {
            dir: options.dir,
            rawHtml,
            overwrite: options.overwrite,
        });
    }
    return report;
}
//# sourceMappingURL=report.js.map