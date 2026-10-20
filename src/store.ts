import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  ExtractedPage,
  PageDetails,
  SearchReport,
  StorageResult,
  StoreOptions,
  StoredPage,
} from "./types.js";

export const DEFAULT_STORE_DIR = "data";
export const INDEX_FILE = "index.jsonl";

const MAX_SLUG_LENGTH = 60;

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return slug || "query";
}

export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    ) {
      url.port = "";
    }
    return url.toString();
  } catch {
    return raw.trim();
  }
}

export function pageKey(url: string): string {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex").slice(0, 12);
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function displayPath(target: string): string {
  const relative = path.relative(process.cwd(), target);
  return relative === "" ? "." : relative;
}

function safeHost(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.replace(/[^a-z0-9.-]/g, "").slice(0, 40) || "page";
  } catch {
    return "page";
  }
}

function stripHtml(page: ExtractedPage): PageDetails {
  const { html: _html, ...details } = page;
  return details;
}

async function writeAtomic(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, file);
}

async function createRunDir(
  base: string,
  name: string,
  overwrite: boolean,
): Promise<string> {
  await mkdir(base, { recursive: true });

  if (overwrite) {
    const dir = path.join(base, name);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  for (let attempt = 0; ; attempt += 1) {
    const dir = path.join(base, attempt === 0 ? name : `${name}-${attempt}`);
    try {
      await mkdir(dir);
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

function pageFileNames(page: ExtractedPage, index: number): StoredPage {
  const position = index + 1;
  const key = pageKey(page.finalUrl || page.url);
  const base = `${String(position).padStart(2, "0")}-${safeHost(page.url)}-${key}`;

  return {
    position,
    url: page.url,
    key,
    file: `pages/${base}.json`,
  };
}

export async function storeReport(
  report: SearchReport,
  pages: readonly ExtractedPage[],
  options: StoreOptions = {},
): Promise<StorageResult> {
  const base = path.resolve(options.dir ?? DEFAULT_STORE_DIR);
  const name = `${slugify(report.query)}-${timestamp(new Date(report.searchedAt))}`;
  const dir = await createRunDir(base, name, options.overwrite ?? false);

  const storedPages: StoredPage[] = [];

  for (const [index, page] of pages.entries()) {
    const stored = pageFileNames(page, index);
    const details = stripHtml(page);
    await writeAtomic(
      path.join(dir, stored.file),
      `${JSON.stringify(details, null, 2)}\n`,
    );

    if (options.rawHtml && page.html) {
      stored.htmlFile = stored.file.replace(/\.json$/, ".html");
      await writeAtomic(path.join(dir, stored.htmlFile), page.html);
    }

    storedPages.push(stored);
  }

  const resultsFile = "results.json";
  const manifestFile = "manifest.json";
  const indexFile = INDEX_FILE;
  const displayDir = displayPath(dir);

  const storage: StorageResult = {
    dir: displayDir,
    manifestFile: path.join(displayDir, manifestFile),
    resultsFile: path.join(displayDir, resultsFile),
    indexFile: path.join(displayPath(base), indexFile),
    pages: storedPages.map((page) => ({
      ...page,
      file: path.join(displayDir, page.file),
      htmlFile: page.htmlFile ? path.join(displayDir, page.htmlFile) : undefined,
    })),
  };

  report.storage = storage;

  await writeAtomic(
    path.join(dir, resultsFile),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const manifest = {
    tool: "ddg-web-search",
    query: report.query,
    searchedAt: report.searchedAt,
    storedAt: new Date().toISOString(),
    directory: displayPath(dir),
    resultCount: report.results.length,
    followedCount: pages.length,
    rawHtml: Boolean(options.rawHtml),
    pages: storedPages,
  };

  await writeAtomic(
    path.join(dir, manifestFile),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const indexEntry = {
    query: report.query,
    searchedAt: report.searchedAt,
    directory: displayPath(dir),
    resultCount: report.results.length,
    followedCount: pages.length,
    urls: storedPages.map((page) => page.url),
  };

  await appendFile(
    path.join(base, indexFile),
    `${JSON.stringify(indexEntry)}\n`,
    "utf8",
  );

  return storage;
}
