import { retry } from 'es-toolkit/function';

import { logVerbose } from './log.ts';

const MIN_RETRY_AFTER_MS = 1500;
const MAX_RETRY_AFTER_MS = 10_000;
const BACKOFF_STEP_MS = 1500;
const DEFAULT_RETRY_ATTEMPTS = 4;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

type FetchWithRetryOptions = {
  maxRetries?: number;
  timeoutMs?: number;
};

class RetryableFetchError extends Error {
  readonly delayMs: number;

  constructor(delayMs: number, message: string) {
    super(message);
    this.name = 'RetryableFetchError';
    this.delayMs = delayMs;
  }
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? DEFAULT_RETRY_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const totalAttempts = Math.max(1, maxRetries);
  let attempt = 0;
  let nextDelayMs = 0;

  return retry(
    async () => {
      const currentAttempt = attempt;
      attempt += 1;
      const isLastAttempt = currentAttempt >= totalAttempts - 1;
      const method = (init.method ?? 'GET').toUpperCase();

      try {
        logVerbose(
          `HTTP request ${method} ${url} (attempt ${currentAttempt + 1}/${totalAttempts})`,
        );

        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
        const response = await fetch(url, {
          ...init,
          signal,
        });

        logVerbose(`HTTP response ${response.status} ${method} ${url}`);

        if (response.status === 429 && !isLastAttempt) {
          const retryAfterMs = getRetryAfterMilliseconds(response);
          if (retryAfterMs > MAX_RETRY_AFTER_MS) {
            return response;
          }

          nextDelayMs = retryAfterMs;
          logVerbose(`HTTP retry scheduled in ${nextDelayMs}ms (rate-limited) ${method} ${url}`);
          throw new RetryableFetchError(nextDelayMs, 'Rate-limited by upstream service.');
        }

        if (response.status >= 500 && !isLastAttempt) {
          nextDelayMs = getBackoffDelayMilliseconds(currentAttempt + 1);
          logVerbose(`HTTP retry scheduled in ${nextDelayMs}ms (5xx) ${method} ${url}`);
          throw new RetryableFetchError(nextDelayMs, 'Upstream service returned a server error.');
        }

        return response;
      } catch (error) {
        if (isLastAttempt) {
          throw error;
        }

        if (error instanceof RetryableFetchError) {
          throw error;
        }

        nextDelayMs = getBackoffDelayMilliseconds(currentAttempt + 1);
        logVerbose(`HTTP retry scheduled in ${nextDelayMs}ms (network failure) ${method} ${url}`);
        throw new RetryableFetchError(nextDelayMs, 'Network request failed.');
      }
    },
    {
      retries: totalAttempts,
      shouldRetry: (error) => error instanceof RetryableFetchError,
      delay: () => {
        const delayMs = nextDelayMs;
        nextDelayMs = 0;
        return delayMs;
      },
    },
  );
}

function getRetryAfterMilliseconds(response: Response): number {
  const retryAfterHeader = response.headers.get('retry-after');
  if (!retryAfterHeader) {
    return MIN_RETRY_AFTER_MS;
  }

  const seconds = Number(retryAfterHeader);
  if (!Number.isNaN(seconds)) {
    return Math.max(seconds * 1000, MIN_RETRY_AFTER_MS);
  }

  const timestamp = Date.parse(retryAfterHeader);
  if (Number.isNaN(timestamp)) {
    return MIN_RETRY_AFTER_MS;
  }

  return Math.max(timestamp - Date.now(), MIN_RETRY_AFTER_MS);
}

function getBackoffDelayMilliseconds(attempt: number): number {
  return Math.max(attempt * BACKOFF_STEP_MS, MIN_RETRY_AFTER_MS);
}
