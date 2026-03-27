import { fetchJson } from "./api-client";

const RETRY_DELAYS_MS = [1000, 2000, 4000];

/**
 * Wraps fetchJson with exponential backoff retry logic.
 * Attempts the request up to 3 times (1s, 2s, 4s between retries).
 * Throws a descriptive error if all attempts fail.
 *
 * @param url - The URL to fetch.
 * @param options - Optional fetch options passed through to fetchJson.
 */
export async function fetchWithRetry<T>(url: string, options?: RequestInit): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetchJson<T>(url, options);
    } catch (err) {
      lastError = err as Error;

      if (attempt < RETRY_DELAYS_MS.length) {
        const delayMs = RETRY_DELAYS_MS[attempt];
        console.warn(
          `[retry] Attempt ${attempt + 1} failed for ${url} — retrying in ${delayMs / 1000}s. Error: ${lastError.message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(
    `[retry] All ${RETRY_DELAYS_MS.length + 1} attempts failed for ${url}. Last error: ${lastError!.message}`
  );
}
