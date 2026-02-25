import { withTimeout } from 'es-toolkit/promise';

import { formatDuration } from '../common/date.ts';

export const SPOTIFY_RESPONSE_TIMEOUT_MS = 12_000;

export function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

export async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await withTimeout(() => response.text(), SPOTIFY_RESPONSE_TIMEOUT_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `<response body unavailable: ${message}>`;
  }
}

export function buildRetryAfterHint(response: Response): string {
  if (response.status !== 429) {
    return '';
  }

  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) {
    return '';
  }

  const durationSeconds = parseRetryAfterSeconds(retryAfter);
  if (durationSeconds === null) {
    return `retry-after: ${retryAfter}`;
  }

  return `retry-after: ${retryAfter}s or ~${formatDuration(durationSeconds)}`;
}

export function getSpotifyRateLimitSummary(response: Response): string | null {
  const remaining =
    response.headers.get('x-ratelimit-remaining') ?? response.headers.get('x-rate-limit-remaining');
  const limit =
    response.headers.get('x-ratelimit-limit') ?? response.headers.get('x-rate-limit-limit');
  const reset =
    response.headers.get('x-ratelimit-reset') ?? response.headers.get('x-rate-limit-reset');
  const retryAfter = response.headers.get('retry-after');

  const details: string[] = [];
  if (remaining !== null) {
    details.push(`remaining=${remaining}`);
  }
  if (limit !== null) {
    details.push(`limit=${limit}`);
  }
  if (reset !== null) {
    details.push(`reset=${reset}`);
  }
  if (retryAfter !== null) {
    details.push(`retry-after=${retryAfter}`);
  }

  return details.length > 0 ? details.join(', ') : null;
}

function parseRetryAfterSeconds(value: string): number | null {
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    return Math.max(0, Math.round(numeric));
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.max(0, Math.round((timestamp - Date.now()) / 1000));
}
