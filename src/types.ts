export interface SearchOptions {
  limit?: number;
  timeoutMs?: number;
}

export interface InstantAnswer {
  text: string;
  url?: string;
  source?: string;
  type: "abstract" | "answer" | "definition";
  related: Array<{ text: string; url: string }>;
}

export interface SearchResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
  hostname: string;
}

export interface SearchResponse {
  query: string;
  instantAnswer?: InstantAnswer;
  results: SearchResult[];
}

export interface PageDetails {
  url: string;
  finalUrl: string;
  title: string;
  description: string;
  headings: string[];
  text: string;
  wordCount: number;
  truncated: boolean;
  contentType: string;
  status: number;
  error?: string;
}

export interface FollowOptions {
  timeoutMs?: number;
  maxChars?: number;
  concurrency?: number;
}

export interface PageExtractOptions {
  timeoutMs?: number;
  maxChars?: number;
  includeHtml?: boolean;
}

export interface ExtractedPage extends PageDetails {
  html?: string;
}

export interface StoreOptions {
  dir?: string;
  save?: boolean;
  rawHtml?: boolean;
  overwrite?: boolean;
}

export interface StoredPage {
  position: number;
  url: string;
  key: string;
  file: string;
  htmlFile?: string;
}

export interface StorageResult {
  dir: string;
  manifestFile: string;
  resultsFile: string;
  indexFile: string;
  pages: StoredPage[];
}

export interface SearchReportOptions
  extends SearchOptions,
    FollowOptions,
    StoreOptions {
  follow?: number;
  followLinks?: boolean;
}

export interface OrganisedSearchResult extends SearchResult {
  details?: PageDetails;
}

export interface SearchReport {
  query: string;
  searchedAt: string;
  instantAnswer?: InstantAnswer;
  results: OrganisedSearchResult[];
  storage?: StorageResult;
}
