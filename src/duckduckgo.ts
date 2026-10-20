import * as cheerio from "cheerio";
import { errorMessage, fetchText } from "./http.js";
import type {
  InstantAnswer,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from "./types.js";

const HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const LITE_ENDPOINT = "https://lite.duckduckgo.com/lite/";
const INSTANT_ANSWER_ENDPOINT = "https://api.duckduckgo.com/";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_TIMEOUT_MS = 10_000;

interface RawTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: RawTopic[];
}

interface RawInstantAnswer {
  Heading?: string;
  AbstractText?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  Answer?: string;
  AnswerType?: string;
  Definition?: string;
  DefinitionURL?: string;
  DefinitionSource?: string;
  RelatedTopics?: RawTopic[];
  Results?: RawTopic[];
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function resolveResultUrl(href: string | undefined): string | undefined {
  if (!href) return undefined;

  let value = href.trim();
  if (value.startsWith("//")) value = `https:${value}`;

  try {
    const parsed = new URL(value, "https://duckduckgo.com");
    if (
      parsed.hostname.endsWith("duckduckgo.com") &&
      parsed.pathname.startsWith("/l/")
    ) {
      const target = parsed.searchParams.get("uddg");
      if (target) return target;
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isBlocked(status: number, body: string): boolean {
  return (
    status === 202 ||
    status === 403 ||
    /anomaly-modal|if this error persists|unusual traffic/i.test(body)
  );
}

function parseHtmlResults(html: string, limit: number): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  $(".result, .web-result").each((_, element) => {
    if (results.length >= limit) return false;

    const node = $(element);
    if (node.hasClass("result--ad") || node.find(".result__a").length === 0) {
      return;
    }

    const anchor = node.find("a.result__a").first();
    const title = cleanText(anchor.text());
    const url = resolveResultUrl(anchor.attr("href"));
    if (!title || !url || seen.has(url)) return;

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

function parseLiteResults(html: string, limit: number): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  $("tr").each((_, row) => {
    if (results.length >= limit) return false;

    const rowNode = $(row);
    const link = rowNode.find("a.result-link").first();
    if (link.length === 0) return;

    const title = cleanText(link.text());
    const url = resolveResultUrl(link.attr("href"));
    if (!title || !url || seen.has(url)) return;

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

async function postQuery(
  endpoint: string,
  query: string,
  timeoutMs: number,
): Promise<Response> {
  return fetchText(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ q: query, kl: "us-en" }).toString(),
    },
    timeoutMs,
  );
}

async function searchWeb(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<SearchResult[]> {
  const endpoints: Array<{
    url: string;
    parse: (html: string, limit: number) => SearchResult[];
  }> = [
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
      if (results.length > 0) return results;
    } catch (error) {
      lastError = errorMessage(error);
    }
  }

  if (receivedResponse) return [];
  throw new Error(`Search failed: ${lastError}`);
}

function flattenTopics(
  topics: RawTopic[] | undefined,
  output: Array<{ text: string; url: string }> = [],
): Array<{ text: string; url: string }> {
  if (!topics) return output;

  for (const topic of topics) {
    if (output.length >= 8) break;
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

async function fetchInstantAnswer(
  query: string,
  timeoutMs: number,
): Promise<InstantAnswer | undefined> {
  const url = new URL(INSTANT_ANSWER_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("no_redirect", "1");
  url.searchParams.set("skip_disambig", "1");

  try {
    const response = await fetchText(
      url.toString(),
      { headers: { Accept: "application/json" } },
      timeoutMs,
    );
    if (!response.ok) return undefined;

    const raw = (await response.json()) as RawInstantAnswer;
    const related = flattenTopics([
      ...(raw.RelatedTopics ?? []),
      ...(raw.Results ?? []),
    ]);

    let text = "";
    let type: InstantAnswer["type"] = "abstract";
    let source: string | undefined;
    let sourceUrl: string | undefined;

    if (raw.Answer && cleanText(raw.Answer)) {
      text = cleanText(raw.Answer);
      type = "answer";
      source = raw.AnswerType;
    } else if (raw.AbstractText && cleanText(raw.AbstractText)) {
      text = cleanText(raw.AbstractText);
      type = "abstract";
      source = raw.AbstractSource;
      sourceUrl = raw.AbstractURL;
    } else if (raw.Definition && cleanText(raw.Definition)) {
      text = cleanText(raw.Definition);
      type = "definition";
      source = raw.DefinitionSource;
      sourceUrl = raw.DefinitionURL;
    }

    if (!text) return undefined;

    return {
      text,
      type,
      url: sourceUrl,
      source: source ? cleanText(source) : undefined,
      related,
    };
  } catch {
    return undefined;
  }
}

export async function search(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Query must not be empty");

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT)),
  );
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const [results, instantAnswer] = await Promise.all([
    searchWeb(trimmed, limit, timeoutMs),
    fetchInstantAnswer(trimmed, timeoutMs),
  ]);

  return { query: trimmed, instantAnswer, results };
}
