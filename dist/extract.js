import * as cheerio from "cheerio";
import { errorMessage, fetchText } from "./http.js";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CHARS = 4_000;
const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_HEADINGS = 12;
const NOISE_SELECTOR = [
    "script",
    "style",
    "noscript",
    "template",
    "svg",
    "canvas",
    "iframe",
    "form",
    "nav",
    "footer",
    "aside",
    "header",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    "[role='complementary']",
    "[aria-hidden='true']",
    ".cookie-banner",
    "#cookie-banner",
    "#onetrust-banner-sdk",
    ".advertisement",
    ".adsbygoogle",
    ".sidebar",
    ".site-header",
    ".site-footer",
].join(",");
const CONTENT_SELECTORS = [
    "article",
    "main",
    "[role='main']",
    "#main",
    "#content",
    ".content",
    ".post",
    ".entry-content",
    ".article-body",
];
const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,div";
function cleanText(value) {
    return value
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function metaContent($, selectors) {
    for (const selector of selectors) {
        const value = $(selector).first().attr("content");
        const cleaned = value ? cleanText(value) : "";
        if (cleaned)
            return cleaned;
    }
    return "";
}
function pickTitle($) {
    const meta = metaContent($, [
        "meta[property='og:title']",
        "meta[name='twitter:title']",
    ]);
    if (meta)
        return meta;
    const title = cleanText($("title").first().text());
    if (title)
        return title;
    return cleanText($("h1").first().text());
}
function pickDescription($) {
    return metaContent($, [
        "meta[name='description']",
        "meta[property='og:description']",
        "meta[name='twitter:description']",
    ]).slice(0, 500);
}
function chooseRoot($) {
    const body = $("body");
    const bodyLength = cleanText(body.text()).length;
    let best = body;
    let bestLength = 0;
    const visited = new Set();
    for (const selector of CONTENT_SELECTORS) {
        $(selector).each((_, element) => {
            if (visited.has(element))
                return;
            visited.add(element);
            const node = $(element);
            const length = cleanText(node.text()).length;
            if (length > bestLength) {
                best = node;
                bestLength = length;
            }
        });
    }
    if (bestLength >= 200 && bestLength >= bodyLength * 0.2)
        return best;
    return body;
}
function extractBlocks($, root) {
    const blocks = [];
    const seen = new Set();
    root.find(BLOCK_SELECTOR).each((_, element) => {
        const node = $(element);
        if (node.find(BLOCK_SELECTOR).length > 0)
            return;
        const text = cleanText(node.text());
        if (!text || seen.has(text))
            return;
        seen.add(text);
        blocks.push(text);
    });
    return blocks.join("\n\n");
}
function extractHeadings($, root) {
    const headings = [];
    const seen = new Set();
    root.find("h1,h2,h3").each((_, element) => {
        if (headings.length >= MAX_HEADINGS)
            return false;
        const text = cleanText($(element).text());
        if (text.length < 2 || text.length > 200 || seen.has(text))
            return;
        seen.add(text);
        headings.push(text);
    });
    return headings;
}
function truncate(text, maxChars) {
    if (text.length <= maxChars)
        return { text, truncated: false };
    const slice = text.slice(0, maxChars);
    const lastSpace = slice.lastIndexOf(" ");
    const cut = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
    return { text: `${cut.trimEnd()}…`, truncated: true };
}
function failedPage(url, status, contentType, message) {
    return {
        url,
        finalUrl: url,
        title: "",
        description: "",
        headings: [],
        text: "",
        wordCount: 0,
        truncated: false,
        contentType,
        status,
        error: message,
    };
}
export async function fetchPageDetails(url, options = {}) {
    const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const maxChars = Math.min(50_000, Math.max(200, Math.floor(options.maxChars ?? DEFAULT_MAX_CHARS)));
    let response;
    try {
        response = await fetchText(url, { headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" } }, timeoutMs);
    }
    catch (error) {
        return failedPage(url, 0, "", errorMessage(error));
    }
    const contentType = response.headers.get("content-type") ?? "";
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    const finalUrl = response.url || url;
    if (contentLength > MAX_RESPONSE_BYTES) {
        return failedPage(url, response.status, contentType, "Page is too large");
    }
    if (!response.ok) {
        return failedPage(url, response.status, contentType, `Request failed with HTTP ${response.status}`);
    }
    let body;
    try {
        const buffer = await response.arrayBuffer();
        const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase() ??
            "utf-8";
        try {
            body = new TextDecoder(charset).decode(buffer);
        }
        catch {
            body = new TextDecoder().decode(buffer);
        }
    }
    catch (error) {
        return failedPage(url, response.status, contentType, errorMessage(error));
    }
    const isHtml = /html/i.test(contentType) ||
        (!contentType && /^\s*<!doctype html|^\s*<html/i.test(body));
    const isPlainText = /^text\/plain/i.test(contentType);
    if (!isHtml && !isPlainText) {
        return failedPage(url, response.status, contentType, `Unsupported content type: ${contentType || "unknown"}`);
    }
    if (isPlainText && !isHtml) {
        const fullText = body.trim();
        const limited = truncate(fullText, maxChars);
        return {
            url,
            finalUrl,
            title: "",
            description: "",
            headings: [],
            text: limited.text,
            wordCount: fullText.split(/\s+/).filter(Boolean).length,
            truncated: limited.truncated,
            contentType,
            status: response.status,
        };
    }
    const $ = cheerio.load(body);
    const title = pickTitle($);
    const description = pickDescription($);
    $(NOISE_SELECTOR).remove();
    const root = chooseRoot($);
    let fullText = extractBlocks($, root);
    if (fullText.length < 50) {
        fullText = cleanText(root.text());
    }
    const limited = truncate(fullText, maxChars);
    return {
        url,
        finalUrl,
        title,
        description,
        headings: extractHeadings($, root),
        text: limited.text,
        wordCount: fullText.split(/\s+/).filter(Boolean).length,
        truncated: limited.truncated,
        contentType,
        status: response.status,
        ...(options.includeHtml ? { html: body } : {}),
    };
}
//# sourceMappingURL=extract.js.map