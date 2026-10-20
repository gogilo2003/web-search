export declare const BROWSER_HEADERS: Record<string, string>;
export declare function timeoutSignal(timeoutMs?: number): AbortSignal;
export declare function fetchText(url: string, init?: RequestInit, timeoutMs?: number): Promise<Response>;
export declare function errorMessage(error: unknown): string;
