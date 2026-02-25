import { Buffer } from 'node:buffer';
import { chunk } from 'es-toolkit/array';
import { withTimeout } from 'es-toolkit/promise';

import { fetchWithRetry } from '../common/fetch.ts';
import { logVerbose } from '../common/log.ts';
import { buildSongKey, cleanupSpaces } from '../common/string.ts';
import { getSpotifyCredentials } from './auth.ts';
import {
  buildRetryAfterHint,
  getSpotifyRateLimitSummary,
  SPOTIFY_RESPONSE_TIMEOUT_MS,
  safeReadResponseText,
} from './utils.ts';

import type {
  AddTracksToPlaylistOptions,
  PlaylistOption,
  PlaylistTracksResponse,
  SpotifyCurrentUser,
  SpotifyPlaylistMeta,
  SpotifyPlaylistTrackIndex,
  SpotifySearchResponse,
  SpotifyTrack,
  SpotifyUserPlaylistsResponse,
} from './types.ts';

export class SpotifyClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly refreshToken: string;

  constructor() {
    const credentials = getSpotifyCredentials();

    this.clientId = credentials.clientId;
    this.clientSecret = credentials.clientSecret;
    this.refreshToken = credentials.refreshToken;
  }

  async searchTracks(query: string, limit = 10): Promise<SpotifyTrack[]> {
    const params = new URLSearchParams({
      q: query,
      type: 'track',
      limit: String(limit),
    });

    const data = await this.apiRequest<SpotifySearchResponse>(
      'GET',
      `https://api.spotify.com/v1/search?${params.toString()}`,
    );

    return data.tracks.items;
  }

  async getPlaylistTrackIndex(playlistId: string): Promise<SpotifyPlaylistTrackIndex> {
    const trackIds = new Set<string>();
    const songKeys = new Set<string>();

    let nextUrl: string | null =
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=50&offset=0`;

    while (nextUrl) {
      const data: PlaylistTracksResponse = await this.apiRequest<PlaylistTracksResponse>(
        'GET',
        nextUrl,
      );

      for (const item of data.items) {
        const track = item.item ?? item.track;

        if (
          !track ||
          !track.id ||
          !track.name ||
          !Array.isArray(track.artists) ||
          track.artists.length === 0
        ) {
          continue;
        }

        trackIds.add(track.id);

        songKeys.add(
          buildSongKey(track.artists.map((artist) => artist.name).join(' '), track.name),
        );
      }

      nextUrl = data.next;
    }

    return { trackIds, songKeys };
  }

  async addTracksToPlaylist(
    playlistId: string,
    uris: string[],
    options?: AddTracksToPlaylistOptions,
  ): Promise<void> {
    const position = options?.position;
    const chunks = chunk(uris, 100);

    const iterableChunks = position === 0 ? chunks.toReversed() : chunks;

    for (const chunkItem of iterableChunks) {
      const payload: { uris: string[]; position?: number } = { uris: chunkItem };

      if (typeof position === 'number') {
        payload.position = position;
      }

      await this.apiRequest(
        'POST',
        `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items`,
        payload,
      );
    }
  }

  async getUserPlaylists(): Promise<PlaylistOption[]> {
    const playlists: PlaylistOption[] = [];
    let nextUrl: string | null =
      'https://api.spotify.com/v1/me/playlists?limit=50&offset=0&fields=items(id,name,public,collaborative,owner(id,display_name),tracks(total)),next';

    while (nextUrl) {
      const data: SpotifyUserPlaylistsResponse =
        await this.apiRequest<SpotifyUserPlaylistsResponse>('GET', nextUrl);

      for (const playlist of data.items) {
        playlists.push({
          id: playlist.id,
          name: cleanupSpaces(playlist.name),
          ownerId: playlist.owner.id,
          ownerName: cleanupSpaces(playlist.owner.display_name || playlist.owner.id || 'unknown'),
          tracksTotal: playlist.tracks.total,
          collaborative: playlist.collaborative,
          isPublic: playlist.public,
        });
      }

      nextUrl = data.next;
    }

    return playlists;
  }

  async getCurrentUser(): Promise<SpotifyCurrentUser> {
    return this.apiRequest<SpotifyCurrentUser>('GET', 'https://api.spotify.com/v1/me');
  }

  async getPlaylistMeta(playlistId: string): Promise<SpotifyPlaylistMeta> {
    const fields = 'id,name,public,collaborative,owner(id,display_name)';

    return this.apiRequest<SpotifyPlaylistMeta>(
      'GET',
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}?fields=${encodeURIComponent(fields)}`,
    );
  }

  private async apiRequest<T>(method: string, url: string, body?: unknown): Promise<T> {
    await this.ensureAccessToken();
    const endpoint = new URL(url).pathname;

    const response = await fetchWithRetry(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      {
        maxRetries: 2,
        timeoutMs: 12_000,
      },
    );

    logVerbose(`Spotify API ${method} ${endpoint} -> ${response.status}`);
    const rateLimitSummary = getSpotifyRateLimitSummary(response);
    if (rateLimitSummary) {
      logVerbose(`Spotify quota headers: ${rateLimitSummary}`);
    }

    if (!response.ok) {
      const errorBody = await safeReadResponseText(response);
      const retryAfterHint = buildRetryAfterHint(response);
      const retryAfterSuffix = retryAfterHint ? ` (${retryAfterHint})` : '';

      throw new Error(
        `Spotify API request failed (${response.status}) ${method} ${endpoint}: ${errorBody.slice(0, 400)}${retryAfterSuffix}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    try {
      return (await withTimeout(
        () => response.json() as Promise<T>,
        SPOTIFY_RESPONSE_TIMEOUT_MS,
      )) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Spotify API response parsing failed ${method} ${endpoint}: ${message}`);
    }
  }

  private async ensureAccessToken(): Promise<void> {
    if (this.accessToken && Date.now() + 30_000 < this.accessTokenExpiresAt) {
      return;
    }

    const tokenResponse = await fetchWithRetry('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorBody = await safeReadResponseText(tokenResponse);
      const retryAfterHint = buildRetryAfterHint(tokenResponse);

      throw new Error(
        `Failed to refresh Spotify access token (${tokenResponse.status})${retryAfterHint}: ${errorBody.slice(0, 400)}`,
      );
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.accessToken = tokenData.access_token;
    this.accessTokenExpiresAt = Date.now() + tokenData.expires_in * 1000;
    logVerbose(`Spotify access token refreshed, expires in ${tokenData.expires_in}s`);
  }
}

export function canCurrentUserWritePlaylist(
  currentUserId: string,
  ownerId: string,
  collaborative: boolean,
): boolean {
  return currentUserId === ownerId || collaborative;
}
