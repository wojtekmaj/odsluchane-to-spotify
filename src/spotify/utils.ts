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
