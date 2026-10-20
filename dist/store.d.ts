import type { ExtractedPage, SearchReport, StorageResult, StoreOptions } from "./types.js";
export declare const DEFAULT_STORE_DIR = "data";
export declare const INDEX_FILE = "index.jsonl";
export declare function slugify(value: string): string;
export declare function normalizeUrl(raw: string): string;
export declare function pageKey(url: string): string;
export declare function storeReport(report: SearchReport, pages: readonly ExtractedPage[], options?: StoreOptions): Promise<StorageResult>;
