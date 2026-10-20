import * as cheerio from "cheerio";
import { errorMessage, fetchText } from "./http.js";
const HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const LITE_ENDPOINT = "https://lite.duckduckgo.com/lite/";
const INSTANT_ANSWER_ENDPOINT = "https://api.duckduckgo.com/";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_TIMEOUT_MS = 10_000;
function cleanText(value) {
    return value.replace(/\s+/g, " ").trim();
}
function hostnameOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    }
    catch {
        return "";
    }
}
function resolveResultUrl(href) {
    if (!href)
        return undefined;
    let value = href.trim();
    if (value.startsWith("//"))
        value = `https:${value}`;
    try {
        const parsed = new URL(value, "https://duckduckgo.com");
        if (parsed.hostname.endsWith("duckduckgo.com") &&
            parsed.pathname.startsWith("/l/")) {
            const target = parsed.searchParams.get("uddg");
            if (target)
                return target;
        }
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            return parsed.toString();
        }
    }
    catch {
        return undefined;
    }
    return undefined;
}
function isBlocked(status, body) {
    return (status === 202 ||
        status === 403 ||
        /anomaly-modal|if this error persists|unusual traffic/i.test(body));
}
function parseHtmlResults(html, limit) {
    const $ = cheerio.load(html);
    const results = [];
    const seen = new Set();
    $(".result, .web-result").each((_, element) => {
        if (results.length >= limit)
            return false;
        const node = $(element);
        if (node.hasClass("result--ad") || node.find(".result__a").length === 0) {
            return;
        }
        const anchor = node.find("a.result__a").first();
        const title = cleanText(anchor.text());
        const url = resolveResultUrl(anchor.attr("href"));
        if (!title || !url || seen.has(url))
            return;
        seen.add(url);
        results.push({
            position: results.length + 1,
            title,
            url,
            snippet: cleanText(node.find(".result__snippet").first().text()),
            hostname: hostnameOf(url),
        });
    });
    return results;
}
function parseLiteResults(html, limit) {
    const $ = cheerio.load(html);
    const results = [];
    const seen = new Set();
    $("tr").each((_, row) => {
        if (results.length >= limit)
            return false;
        const rowNode = $(row);
        const link = rowNode.find("a.result-link").first();
        if (link.length === 0)
            return;
        const title = cleanText(link.text());
        const url = resolveResultUrl(link.attr("href"));
        if (!title || !url || seen.has(url))
            return;
        let snippet = "";
        let cursor = rowNode.next("tr");
        while (cursor.length > 0 && cursor.find("a.result-link").length === 0) {
            const snippetNode = cursor.find(".result-snippet").first();
            if (snippetNode.length > 0) {
                snippet = cleanText(snippetNode.text());
                break;
            }
            cursor = cursor.next("tr");
        }
        seen.add(url);
        results.push({
            position: results.length + 1,
            title,
            url,
            snippet,
            hostname: hostnameOf(url),
        });
    });
    return results;
}
async function postQuery(endpoint, query, timeoutMs) {
    return fetchText(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ q: query, kl: "us-en" }).toString(),
    }, timeoutMs);
}
async function searchWeb(query, limit, timeoutMs) {
    const endpoints = [
        { url: HTML_ENDPOINT, parse: parseHtmlResults },
        { url: LITE_ENDPOINT, parse: parseLiteResults },
    ];
    let receivedResponse = false;
    let lastError = "DuckDuckGo returned no results";
    for (const endpoint of endpoints) {
        try {
            const response = await postQuery(endpoint.url, query, timeoutMs);
            const body = await response.text();
            if (isBlocked(response.status, body)) {
                lastError =
                    "DuckDuckGo blocked the request (rate limit or CAPTCHA). Try again later.";
                continue;
            }
            if (!response.ok) {
                lastError = `DuckDuckGo responded with HTTP ${response.status}`;
                continue;
            }
            receivedResponse = true;
            const results = endpoint.parse(body, limit);
            if (results.length > 0)
                return results;
        }
        catch (error) {
            lastError = errorMessage(error);
        }
    }
    if (receivedResponse)
        return [];
    throw new Error(`Search failed: ${lastError}`);
}
function flattenTopics(topics, output = []) {
    if (!topics)
        return output;
    for (const topic of topics) {
        if (output.length >= 8)
            break;
        if (topic.Topics) {
            flattenTopics(topic.Topics, output);
            continue;
        }
        const text = cleanText(topic.Text ?? "");
        if (text && topic.FirstURL) {
            output.push({ text, url: topic.FirstURL });
        }
    }
    return output;
}
async function fetchInstantAnswer(query, timeoutMs) {
    const url = new URL(INSTANT_ANSWER_ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("no_redirect", "1");
    url.searchParams.set("skip_disambig", "1");
    try {
        const response = await fetchText(url.toString(), { headers: { Accept: "application/json" } }, timeoutMs);
        if (!response.ok)
            return undefined;
        const raw = (await response.json());
        const related = flattenTopics([
            ...(raw.RelatedTopics ?? []),
            ...(raw.Results ?? []),
        ]);
        let text = "";
        let type = "abstract";
        let source;
        let sourceUrl;
        if (raw.Answer && cleanText(raw.Answer)) {
            text = cleanText(raw.Answer);
            type = "answer";
            source = raw.AnswerType;
        }
        else if (raw.AbstractText && cleanText(raw.AbstractText)) {
            text = cleanText(raw.AbstractText);
            type = "abstract";
            source = raw.AbstractSource;
            sourceUrl = raw.AbstractURL;
        }
        else if (raw.Definition && cleanText(raw.Definition)) {
            text = cleanText(raw.Definition);
            type = "definition";
            source = raw.DefinitionSource;
            sourceUrl = raw.DefinitionURL;
        }
        if (!text)
            return undefined;
        return {
            text,
            type,
            url: sourceUrl,
            source: source ? cleanText(source) : undefined,
            related,
        };
    }
    catch {
        return undefined;
    }
}
export async function search(query, options = {}) {
    const trimmed = query.trim();
    if (!trimmed)
        throw new Error("Query must not be empty");
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT)));
    const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const [results, instantAnswer] = await Promise.all([
        searchWeb(trimmed, limit, timeoutMs),
        fetchInstantAnswer(trimmed, timeoutMs),
    ]);
    return { query: trimmed, instantAnswer, results };
}
//# sourceMappingURL=duckduckgo.js.map