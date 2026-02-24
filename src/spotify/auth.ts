import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';

import { fetchWithRetry } from '../common/fetch.ts';
import { buildRetryAfterHint, requiredEnv, safeReadResponseText } from './utils.ts';

import type { SpotifyAuthTokenResponse } from './types.ts';

const SPOTIFY_SCOPES: string = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
].join(' ');

type SpotifyCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export function getSpotifyCredentials(): SpotifyCredentials {
  return {
    clientId: requiredEnv('SPOTIFY_CLIENT_ID'),
    clientSecret: requiredEnv('SPOTIFY_CLIENT_SECRET'),
    refreshToken: requiredEnv('SPOTIFY_REFRESH_TOKEN'),
  };
}

export function getSpotifyRedirectUri(): string {
  return process.env.SPOTIFY_REDIRECT_URI ?? 'http://127.0.0.1:8888/callback';
}

export function buildSpotifyAuthUrl(redirectUri: string): string {
  const clientId = requiredEnv('SPOTIFY_CLIENT_ID');
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES,
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeSpotifyAuthorizationCode(
  code: string,
  redirectUri: string,
): Promise<SpotifyAuthTokenResponse> {
  const clientId = requiredEnv('SPOTIFY_CLIENT_ID');
  const clientSecret = requiredEnv('SPOTIFY_CLIENT_SECRET');

  const tokenResponse = await fetchWithRetry('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    const errorBody = await safeReadResponseText(tokenResponse);
    const retryAfterHint = buildRetryAfterHint(tokenResponse);
    throw new Error(
      `Token exchange failed (${tokenResponse.status})${retryAfterHint}: ${errorBody.slice(0, 400)}`,
    );
  }

  return (await tokenResponse.json()) as SpotifyAuthTokenResponse;
}

export async function saveRefreshTokenToEnv(refreshToken: string, filePath: string): Promise<void> {
  await upsertEnvVar(filePath, 'SPOTIFY_REFRESH_TOKEN', refreshToken);
}

async function upsertEnvVar(filePath: string, key: string, value: string): Promise<void> {
  let content = '';
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }

  const lines = content === '' ? [] : content.split(/\r?\n/);
  const nextLines: string[] = [];
  const prefix = `${key}=`;
  let inserted = false;

  for (const line of lines) {
    if (line.trimStart().startsWith(prefix)) {
      if (!inserted) {
        nextLines.push(`${key}=${value}`);
        inserted = true;
      }

      continue;
    }

    nextLines.push(line);
  }

  if (!inserted) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== '') {
      nextLines.push('');
    }

    nextLines.push(`${key}=${value}`);
  }

  const normalized = `${nextLines.join('\n').replace(/\n+$/g, '')}\n`;
  await fs.writeFile(filePath, normalized, 'utf8');
}
