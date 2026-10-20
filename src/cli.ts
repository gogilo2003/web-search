#!/usr/bin/env node
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { formatReport } from "./format.js";
import { runSearchReport } from "./report.js";
import { DEFAULT_STORE_DIR } from "./store.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version?: string };

const HELP = `Usage: web-search [options] <query>

Search DuckDuckGo, then optionally follow the top results and extract their
content.

Options:
  -n, --results <n>      Number of search results to return (default: 10, max: 50)
  -f, --follow <n>       Number of top results to follow and extract (default: 5)
      --follow-links     Follow result links and extract pages (default)
      --no-follow-links  Skip following; return search results only
  -t, --timeout <ms>     Per-request timeout in milliseconds (default: 10000)
  -c, --chars <n>        Max extracted characters per page (default: 2000)
  -s, --save             Save the report and extracted pages to disk
  -o, --out <dir>        Save to this directory (default: data)
      --raw-html         Also store the raw HTML of followed pages
      --json             Print the full report as JSON
  -h, --help             Show this help
  -v, --version          Show the version

Link following:
  By default the top 5 results are fetched and scraped. Use -f to change how
  many are followed, or --no-follow-links (same as -f 0) to stop after search.

Examples:
  web-search "typescript generics"
  web-search -n 20 -f 10 "node.js streams"
  web-search -n 10 --no-follow-links "search only"
  web-search -s "rust ownership"
  web-search -s -o ./output --raw-html "typescript decorators"
  web-search --json "duckduckgo api" > results.json

Using npm scripts:
  npm run help
  npm start -- --help
  npm start -- -n 10 --no-follow-links "search only"`;

function intOption(
  value: string | boolean | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string") {
    throw new Error(`--${name} requires a value`);
  }

  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw new Error(`--${name} must be an integer`);
  }

  return Math.min(max, Math.max(min, number));
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      results: { type: "string", short: "n", default: "10" },
      follow: { type: "string", short: "f", default: "5" },
      "follow-links": { type: "boolean", default: true },
      "no-follow-links": { type: "boolean", default: false },
      timeout: { type: "string", short: "t", default: "10000" },
      chars: { type: "string", short: "c", default: "2000" },
      save: { type: "boolean", short: "s", default: false },
      out: { type: "string", short: "o" },
      "raw-html": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  if (values.version) {
    console.log(pkg.version ?? "0.0.0");
    return;
  }

  const query = positionals.join(" ").trim();
  if (!query) {
    console.error("Error: a search query is required\n");
    console.error(HELP);
    process.exitCode = 1;
    return;
  }

  const results = intOption(values.results, "results", 10, 1, 50);
  const follow = intOption(values.follow, "follow", 5, 0, results);
  const timeoutMs = intOption(values.timeout, "timeout", 10_000, 500, 120_000);
  const maxChars = intOption(values.chars, "chars", 2_000, 200, 50_000);

  const followLinks =
    !values["no-follow-links"] && values["follow-links"];

  const report = await runSearchReport(query, {
    limit: results,
    follow,
    followLinks,
    timeoutMs,
    maxChars,
    save: values.save || values.out !== undefined,
    dir: values.out ?? DEFAULT_STORE_DIR,
    rawHtml: values["raw-html"],
  });

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatReport(report));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
