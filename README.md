# ddg-web-search

A TypeScript web search tool that queries DuckDuckGo, organises the results, and
fetches the pages behind the top results to extract their main content.

## Features

- DuckDuckGo Instant Answer API for abstracts, answers, and related topics
- DuckDuckGo HTML search results (with a lite-endpoint fallback), parsed into a
  clean, ranked list
- Fetches the top N results concurrently and extracts:
  - page title and meta description
  - headings
  - readable body text (scripts, navigation, cookie banners, etc. removed)
  - word count and truncation status
- Per-request timeouts, concurrency limits, and per-page error isolation
- Optional local storage of each run: report, per-page extracts, manifest, and
  an append-only run index, with optional raw HTML capture
- Human-readable terminal output or machine-readable JSON
- Usable as a CLI or as a library

## Requirements

- Node.js 20 or newer

## Install

```bash
npm install
npm run build
```

Run from source during development:

```bash
npm run dev -- "typescript generics"
```

Run the compiled CLI:

```bash
npm start -- "typescript generics"
```

Optionally link it globally:

```bash
npm link
ddg-search "typescript generics"
```

## Getting help

```bash
npm run help                  # rich CLI help, from source
npm start -- --help           # same, via the compiled CLI
```

`npm run start --help` shows npm's own help, not the tool's: npm consumes the
flag before running the script. Pass flags after `--`, as in
`npm start -- --help` or `npm start -- -n 10 "search only"`.

## CLI usage

```text
ddg-search [options] <query>

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
```

Examples:

```bash
ddg-search "how does duckduckgo work"
ddg-search -n 20 -f 10 "node.js streams"
ddg-search -n 10 --no-follow-links "search only"
ddg-search --save "node.js streams"
ddg-search -s -o ./output --raw-html "typescript decorators"
ddg-search --json "typescript decorators" > results.json
ddg-search -f 0 "search results only"

# Through npm (flags must come after --)
npm start -- -n 10 --no-follow-links "search only"
```

`--follow-links` is on by default. Use `--no-follow-links` (or `-f 0`) to stop
after the search step, and `-f/--follow <n>` to choose how many of the returned
results are followed and scraped.

## Local storage

Pass `--save` (or `--out <dir>`, which implies it) to persist a run:

```text
data/
  index.jsonl                                  # one line per run, all queries
  nodejs-streams-2026-10-20T17-52-00-000Z/
    manifest.json                              # query, options, page list
    results.json                               # the full report
    pages/
      01-nodejs-org-a1b2c3d4e5f6.json         # extracted page details
      01-nodejs-org-a1b2c3d4e5f6.html         # only with --raw-html
```

Each run gets its own timestamped directory, so runs never overwrite each other.
Page files are keyed by a hash of the normalised URL and written atomically.
`index.jsonl` is appended to and is the easiest place to list or query past runs.

Library equivalents:

```ts
const report = await runSearchReport("node.js streams", {
  follow: 5,
  followLinks: true,
  save: true,
  dir: "data",
  rawHtml: true,
});

const searchOnly = await runSearchReport("node.js streams", {
  followLinks: false,
});

console.log(report.storage?.dir);
console.log(report.storage?.pages);
```

## Library usage

```ts
import { runSearchReport, search, fetchPageDetails } from "ddg-web-search";

const report = await runSearchReport("typescript generics", {
  limit: 10,
  follow: 5,
  followLinks: true,
  timeoutMs: 10_000,
  maxChars: 4_000,
  concurrency: 5,
});

console.log(report.results[0]?.details?.text);

const response = await search("duckduckgo api", { limit: 5 });
const page = await fetchPageDetails(response.results[0]!.url);
```

The JSON report has this shape:

```jsonc
{
  "query": "typescript generics",
  "searchedAt": "2026-10-19T00:00:00.000Z",
  "instantAnswer": {
    "text": "…",
    "type": "abstract",
    "url": "https://…",
    "source": "Wikipedia",
    "related": [{ "text": "…", "url": "https://…" }]
  },
  "results": [
    {
      "position": 1,
      "title": "…",
      "url": "https://…",
      "snippet": "…",
      "hostname": "example.com",
      "details": {
        "url": "https://…",
        "finalUrl": "https://…",
        "title": "…",
        "description": "…",
        "headings": ["…"],
        "text": "…",
        "wordCount": 1234,
        "truncated": false,
        "contentType": "text/html; charset=utf-8",
        "status": 200
      }
    }
  ],
  "storage": {
    "dir": "data/typescript-generics-2026-10-20T17-52-00-000Z",
    "manifestFile": "data/…/manifest.json",
    "resultsFile": "data/…/results.json",
    "indexFile": "data/index.jsonl",
    "pages": [
      {
        "position": 1,
        "url": "https://…",
        "key": "a1b2c3d4e5f6",
        "file": "data/…/pages/01-example-com-a1b2c3d4e5f6.json"
      }
    ]
  }
}
```

`storage` is only present when saving is enabled.

## How it works

1. The query is sent to the DuckDuckGo Instant Answer API and to the DuckDuckGo
   HTML search endpoint in parallel.
2. Search result links are unwrapped from DuckDuckGo redirect URLs, deduplicated,
   and ranked.
3. Unless link following is disabled, the first `--follow` results are fetched
   concurrently. Each page is cleaned with Cheerio, boilerplate is removed, and
   the main content is extracted.
4. Results are returned with the extracted details attached to the followed
   entries.
5. When saving is enabled, the report, per-page extracts, a manifest, and an
   index entry are written to a new timestamped directory.

## Notes and limitations

- DuckDuckGo does not offer an official API for general web results. This tool
  uses the public Instant Answer API plus the HTML results endpoint. It may be
  rate limited or blocked if used aggressively, and DuckDuckGo's markup can
  change over time.
- Content extraction is heuristic. JavaScript-rendered pages, PDFs, and pages
  behind logins or paywalls will have little or no extractable text.
- Respect DuckDuckGo's terms of service and the terms of the sites you fetch.
