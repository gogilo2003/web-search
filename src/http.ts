const DEFAULT_TIMEOUT_MS = 10_000;

export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
};

export function timeoutSignal(timeoutMs = DEFAULT_TIMEOUT_MS): AbortSignal {
  const ms = Math.max(1, Math.floor(timeoutMs));
  return AbortSignal.timeout(ms);
}

export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: "follow",
    signal: init.signal ?? timeoutSignal(timeoutMs),
    headers: {
      ...BROWSER_HEADERS,
      ...(init.headers ?? {}),
    },
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "Request timed out";
    }
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      return cause.message;
    }
    return error.message;
  }
  return String(error);
}
