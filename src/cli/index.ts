#!/usr/bin/env node

import fs from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { search } from '@inquirer/prompts';
import { delay } from 'es-toolkit/promise';
import { createSpinner, type Spinner } from 'nanospinner';
import open from 'open';

import { parseInputDate } from '../common/date.ts';
import { buildSongKey, cleanupSpaces, normalize } from '../common/string.ts';
import {
  buildSourceUrl,
  fetchStationsFromOdsluchane,
  scrapeSongsFromSource,
} from '../odsluchane/index.ts';
import {
  getTodayDateInWarsaw,
  isWindowFullyInFutureInWarsaw,
  isWindowFullyInPastInWarsaw,
} from '../odsluchane/utils.ts';
import {
  buildSpotifyAuthUrl,
  exchangeSpotifyAuthorizationCode,
  getSpotifyRedirectUri,
  saveRefreshTokenToEnv,
} from '../spotify/auth.ts';
import { canCurrentUserWritePlaylist, SpotifyClient } from '../spotify/index.ts';
import {
  buildStationGroupOptions,
  buildWindows,
  filterSelectOptionsByName,
  formatDdMmYyyyForDisplay,
  formatWindowProgressText,
  normalizePlaylistId,
  parseCliArgs,
  parseIntegerString,
  readOptionalStringArg,
} from './utils.ts';

import type {
  OAuthCallbackRequestInput,
  ParsedArgs,
  SelectOption,
  State,
  SyncStats,
  SyncSummaryInput,
  WaitForAuthorizationCodeInput,
  WindowProgressInput,
} from '../common/types.ts';
import type { ScrapedSong } from '../odsluchane/types.ts';
import type { SpotifyAuthTokenResponse, SpotifyTrack } from '../spotify/types.ts';

const APP_VERSION = 1;
const DEFAULT_TIME_FROM = 0;
const DEFAULT_TIME_TO = 24;
const DEFAULT_WINDOW_HOURS = 2;
const DEFAULT_SOURCE_DELAY_MS = 2500;
const DEFAULT_SPOTIFY_DELAY_MS = 120;

const STATE_PATH = path.join(process.cwd(), '.cache', 'state.json');

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const command = args._[0];

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
      printHelp();
      return;
    case 'map':
      await runMapCommand(args);
      return;
    case 'auth':
      await runAuthCommand(args);
      return;
    case 'sync':
      await runSyncCommand(args);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function runMapCommand(args: ParsedArgs): Promise<void> {
  const state = await loadState();
  const stationArg = typeof args.station === 'string' ? args.station.trim() : '';
  const playlistArg = typeof args.playlist === 'string' ? normalizePlaylistId(args.playlist) : '';
  const stationName =
    typeof args['station-name'] === 'string' ? cleanupSpaces(args['station-name']) : '';
  const playlistName =
    typeof args['playlist-name'] === 'string' ? cleanupSpaces(args['playlist-name']) : '';

  if (stationArg && playlistArg) {
    state.stationPlaylists[stationArg] = playlistArg;
    await saveState(state);
    console.log(`Saved mapping: station ${stationArg} -> playlist ${playlistArg}`);
    return;
  }

  await runInteractiveMapFlow(state, {
    stationName,
    playlistName,
  });
}

async function runInteractiveMapFlow(
  state: State,
  filters: { stationName: string; playlistName: string },
): Promise<void> {
  console.log('Loading station list from odsluchane.eu…');
  const stations = await fetchStationsFromOdsluchane();
  const stationOptions = stations.map((stationItem) => ({
    id: stationItem.id,
    label: stationItem.name,
    searchText: `${stationItem.name} ${stationItem.groupName} ${stationItem.id}`,
    groupName: stationItem.groupName,
  }));
  const filteredStationOptions = filterSelectOptionsByName(stationOptions, filters.stationName);

  if (filters.stationName && filteredStationOptions.length === 0) {
    throw new Error(`Select station: no matches for name filter "${filters.stationName}".`);
  }

  const groupOptions = buildStationGroupOptions(filteredStationOptions);
  if (groupOptions.length === 0) {
    throw new Error('Select station group: no station groups available.');
  }

  let stationGroup: SelectOption;
  if (groupOptions.length === 1) {
    const firstGroup = groupOptions[0];
    if (!firstGroup) {
      throw new Error('Select station group: unexpected empty selection result.');
    }

    stationGroup = firstGroup;
    console.log(`Select station group: auto-selected ${stationGroup.label}`);
  } else {
    stationGroup = await promptSelectOption('Select station group', groupOptions);
  }

  const stationOptionsInGroup = filteredStationOptions.filter(
    (stationOption) => stationOption.groupName === stationGroup.id,
  );

  const station = await resolveSelectOptionWithNameFilter(
    'Select station',
    stationOptionsInGroup,
    filters.stationName,
    'station-name',
  );

  console.log('\nLoading your Spotify playlists…');
  const spotify = new SpotifyClient();
  const currentUser = await spotify.getCurrentUser();
  const playlists = await spotify.getUserPlaylists();
  const writablePlaylists = playlists.filter((playlistItem) =>
    canCurrentUserWritePlaylist(currentUser.id, playlistItem.ownerId, playlistItem.collaborative),
  );

  if (writablePlaylists.length === 0) {
    throw new Error('No writable Spotify playlists available (owner or collaborative).');
  }

  const playlistOptions = writablePlaylists.map((playlistItem) => ({
    id: playlistItem.id,
    label: `${playlistItem.name} (${playlistItem.id}) - owner: ${playlistItem.ownerName}, tracks: ${playlistItem.tracksTotal}, collaborative: ${
      playlistItem.collaborative ? 'yes' : 'no'
    }, public: ${
      playlistItem.isPublic === null ? 'unknown' : playlistItem.isPublic ? 'yes' : 'no'
    }`,
    searchText: `${playlistItem.name} ${playlistItem.id} ${playlistItem.ownerName} ${
      playlistItem.collaborative ? 'collaborative' : ''
    }`,
  }));
  const playlist = await resolveSelectOptionWithNameFilter(
    'Select playlist',
    playlistOptions,
    filters.playlistName,
    'playlist-name',
  );

  state.stationPlaylists[station.id] = playlist.id;
  await saveState(state);

  console.log(`\nSaved mapping: station ${station.label} -> playlist ${playlist.label}`);
}

async function resolveSelectOptionWithNameFilter<T extends SelectOption>(
  title: string,
  options: T[],
  nameFilter: string,
  nameFilterArg: 'station-name' | 'playlist-name',
): Promise<T> {
  const filteredOptions = filterSelectOptionsByName(options, nameFilter);

  if (nameFilter && filteredOptions.length === 0) {
    throw new Error(`${title}: no matches for name filter "${nameFilter}".`);
  }

  if (nameFilter && filteredOptions.length === 1) {
    const selected = filteredOptions[0];
    if (!selected) {
      throw new Error(`${title}: unexpected empty selection result.`);
    }
    console.log(
      `${title}: auto-selected by --${nameFilterArg} "${nameFilter}" -> ${selected.label}`,
    );
    return selected;
  }

  if (nameFilter) {
    console.log(
      `${title}: --${nameFilterArg} "${nameFilter}" matched ${filteredOptions.length} results.`,
    );
  }

  return promptSelectOption(title, filteredOptions);
}

async function promptSelectOption<T extends SelectOption>(title: string, options: T[]): Promise<T> {
  if (options.length === 0) {
    throw new Error(`No options available for "${title}".`);
  }

  return search<T>({
    message: title,
    pageSize: 15,
    source: async (term) => {
      const query = cleanupSpaces(term ?? '');
      const filtered = query ? filterSelectOptionsByName(options, query) : options;
      return filtered.map((option) => ({
        value: option,
        name: option.label,
      }));
    },
  });
}

async function runAuthCommand(args: ParsedArgs): Promise<void> {
  const redirectUri = getSpotifyRedirectUri();
  const redirectUrl = new URL(redirectUri);
  const timeoutMsRaw = readOptionalStringArg(args, 'timeout-ms');
  const timeoutMs =
    timeoutMsRaw === undefined ? 180_000 : parseIntegerString(timeoutMsRaw, 'timeout-ms');

  if (redirectUrl.protocol !== 'http:') {
    throw new Error(
      `SPOTIFY_REDIRECT_URI must use http:// for local listener flow. Current: ${redirectUri}`,
    );
  }

  const hostname = redirectUrl.hostname;
  const port = Number.parseInt(redirectUrl.port || '80', 10);
  const callbackPath = redirectUrl.pathname || '/';
  const authUrl = buildSpotifyAuthUrl(redirectUri);

  console.log(`Listening on ${redirectUri}`);
  console.log(`Opening authorization URL in your default browser:\n${authUrl}`);
  console.log("Open it manually if auto-open doesn't work.");
  try {
    await open(authUrl, { wait: false });
    console.log('Opened authorization URL in your default browser.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Could not auto-open browser (${message}). Open the URL manually.`);
  }

  const code = await waitForAuthorizationCode({
    hostname,
    port,
    callbackPath,
    timeoutMs,
  });

  console.log('Authorization callback received. Exchanging code for tokens…');
  const tokenData = await exchangeSpotifyAuthorizationCode(code, redirectUri);
  await printAuthExchangeSummary(tokenData);
}

async function printAuthExchangeSummary(tokenData: SpotifyAuthTokenResponse): Promise<void> {
  console.log('Token exchange succeeded.');
  console.log(`Access token expires in: ${tokenData.expires_in} seconds`);

  if (!tokenData.refresh_token) {
    console.log(
      'No refresh_token returned. If you already authorized this app before, re-authorize with a fresh consent.',
    );
    return;
  }

  try {
    await saveRefreshTokenToEnv(tokenData.refresh_token, path.join(process.cwd(), '.env'));
    console.log('\nSaved SPOTIFY_REFRESH_TOKEN to .env');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`\nCould not update .env automatically (${message}).`);
    console.log(`Set this manually:\nSPOTIFY_REFRESH_TOKEN=${tokenData.refresh_token}`);
  }
}

async function waitForAuthorizationCode(input: WaitForAuthorizationCodeInput): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      fn();
    };

    const server = createServer((req, res) => {
      handleOAuthCallbackRequest(
        req,
        res,
        input,
        (code) =>
          finish(() => {
            server.close(() => resolve(code));
          }),
        (error) =>
          finish(() => {
            server.close(() => reject(error));
          }),
      );
    });

    server.once('error', (error) =>
      finish(() => {
        reject(error);
      }),
    );

    server.listen(input.port, input.hostname, () => {
      const timer = setTimeout(() => {
        finish(() => {
          server.close(() => {
            reject(
              new Error(
                `Authorization timed out after ${Math.round(input.timeoutMs / 1000)} seconds.`,
              ),
            );
          });
        });
      }, input.timeoutMs);

      server.once('close', () => {
        clearTimeout(timer);
      });
    });
  });
}

function handleOAuthCallbackRequest(
  req: IncomingMessage,
  res: ServerResponse,
  input: OAuthCallbackRequestInput,
  onCode: (code: string) => void,
  onError: (error: Error) => void,
): void {
  const baseUrl = `http://${input.hostname}:${input.port}`;
  const requestUrl = new URL(req.url ?? '/', baseUrl);

  if (requestUrl.pathname !== input.callbackPath) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  const error = requestUrl.searchParams.get('error');
  if (error) {
    writeHtmlResponse(res, 400, `<h1>Authorization failed</h1><p>${escapeHtml(error)}</p>`);
    onError(new Error(`Spotify authorization failed: ${error}`));
    return;
  }

  const code = requestUrl.searchParams.get('code');
  if (!code) {
    writeHtmlResponse(
      res,
      400,
      '<h1>Missing code</h1><p>No authorization code found in callback query string.</p>',
    );
    onError(new Error('Missing "code" parameter in Spotify callback.'));
    return;
  }

  writeHtmlResponse(
    res,
    200,
    '<h1>Authorization received</h1><p>You can close this tab and return to your terminal.</p>',
  );
  onCode(code);
}

function writeHtmlResponse(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(
    `<!doctype html><html><body style="font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 16px">${body}</body></html>`,
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function runSyncCommand(args: ParsedArgs): Promise<void> {
  const { stationId, stationLabel } = await resolveStationForSync(args);
  const date = String(args.date ?? getTodayDateInWarsaw());
  parseInputDate(date);

  const timeFromRaw = readOptionalStringArg(args, 'from');
  const timeFrom =
    timeFromRaw === undefined ? DEFAULT_TIME_FROM : parseIntegerString(timeFromRaw, 'from');

  const timeToRaw = readOptionalStringArg(args, 'to');
  const timeTo = timeToRaw === undefined ? DEFAULT_TIME_TO : parseIntegerString(timeToRaw, 'to');

  const windowHoursRaw = readOptionalStringArg(args, 'window');
  const windowHours =
    windowHoursRaw === undefined
      ? DEFAULT_WINDOW_HOURS
      : parseIntegerString(windowHoursRaw, 'window');

  const sourceDelayMsRaw = readOptionalStringArg(args, 'source-delay-ms');
  const sourceDelayMs =
    sourceDelayMsRaw === undefined
      ? DEFAULT_SOURCE_DELAY_MS
      : parseIntegerString(sourceDelayMsRaw, 'source-delay-ms');

  const spotifyDelayMsRaw = readOptionalStringArg(args, 'spotify-delay-ms');
  const spotifyDelayMs =
    spotifyDelayMsRaw === undefined
      ? DEFAULT_SPOTIFY_DELAY_MS
      : parseIntegerString(spotifyDelayMsRaw, 'spotify-delay-ms');
  const dryRun = Boolean(args['dry-run']);
  const force = Boolean(args.force);

  if (timeFrom < 0 || timeFrom > 23 || timeTo < 1 || timeTo > 24 || timeFrom >= timeTo) {
    throw new Error('Invalid --from/--to values. Expected 0 <= from < to <= 24.');
  }

  if (windowHours < 1 || windowHours > 2) {
    throw new Error('Invalid --window value. odsluchane supports max 2 hours per request.');
  }

  const state = await loadState();

  if (args.playlist) {
    state.stationPlaylists[stationId] = normalizePlaylistId(String(args.playlist));
    await saveState(state);
  }

  const playlistId = state.stationPlaylists[stationId];

  if (!playlistId) {
    throw new Error(
      `No playlist mapped for station ${stationId}. Run: yarn map --station ${stationId} --playlist <spotify_playlist_id>`,
    );
  }

  const displayDate = formatDdMmYyyyForDisplay(date);

  console.log(`Syncing ${stationLabel} for ${displayDate}…`);
  console.log('Loading Spotify account…');

  const spotify = new SpotifyClient();
  const currentUser = await spotify.getCurrentUser();

  console.log(`Spotify account loaded: ${currentUser.id}`);
  console.log(`Loading mapped playlist metadata (${playlistId})…`);

  const playlistMeta = await spotify.getPlaylistMeta(playlistId);

  console.log(`Playlist metadata loaded: ${playlistMeta.name} (${playlistMeta.id})`);

  if (
    !canCurrentUserWritePlaylist(
      currentUser.id,
      playlistMeta.owner.id,
      playlistMeta.collaborative,
    ) &&
    !dryRun
  ) {
    throw new Error(
      `Mapped playlist "${playlistMeta.name}" (${playlistMeta.id}) is not writable by "${currentUser.id}". ` +
        'Choose a playlist you own or a collaborative playlist using: yarn map',
    );
  }

  console.log('Loading playlist track index (for duplicate detection)…');

  const playlistIndex = await spotify.getPlaylistTrackIndex(playlistId);

  const stats: SyncStats = {
    windowsPlanned: 0,
    windowsSkippedAlreadyDone: 0,
    windowsSkippedFuture: 0,
    windowsProcessed: 0,
    windowsNotMarkedNotInPast: 0,
    songsScraped: 0,
    songsDuplicateSkipped: 0,
    songsAlreadyInPlaylistSkipped: 0,
    songsMatched: 0,
    songsUnmatched: 0,
    tracksAdded: 0,
  };

  const windows = buildWindows(timeFrom, timeTo, windowHours);
  stats.windowsPlanned = windows.length;

  const progressReporter = windows.length > 0 ? new WindowProgressReporter(windows.length) : null;

  const runSeenSongKeys = new Set<string>();
  let completedWindows = 0;

  try {
    const firstWindow = windows[0];
    if (firstWindow && progressReporter) {
      progressReporter.update({
        completed: 0,
        total: windows.length,
        window: firstWindow,
        status: 'waiting',
      });
    }

    for (const window of windows) {
      const windowKey = `${window.from}-${window.to}`;
      progressReporter?.update({
        completed: completedWindows,
        total: windows.length,
        window,
        status: 'scraping',
      });

      if (isWindowFullyInFutureInWarsaw(date, window.from)) {
        stats.windowsSkippedFuture += 1;
        completedWindows += 1;
        progressReporter?.update({
          completed: completedWindows,
          total: windows.length,
          window,
          status: 'future',
        });
        continue;
      }

      if (!force && isWindowAlreadyProcessed(state, stationId, date, windowKey)) {
        stats.windowsSkippedAlreadyDone += 1;
        completedWindows += 1;
        progressReporter?.update({
          completed: completedWindows,
          total: windows.length,
          window,
          status: 'skipped',
        });
        continue;
      }

      const sourceUrl = buildSourceUrl(stationId, date, window.from, window.to);
      const songs = await scrapeSongsFromSource(sourceUrl);
      stats.songsScraped += songs.length;

      const urisToAdd: string[] = [];

      for (const [index, song] of songs.entries()) {
        const songKey = buildSongKey(song.artist, song.title);

        if (runSeenSongKeys.has(songKey)) {
          stats.songsDuplicateSkipped += 1;
          continue;
        }

        if (playlistIndex.songKeys.has(songKey)) {
          runSeenSongKeys.add(songKey);
          stats.songsAlreadyInPlaylistSkipped += 1;
          continue;
        }

        if (spotifyDelayMs > 0 && index > 0) {
          await delay(spotifyDelayMs);
        }

        const spotifyTrack = await findTrackForSong(spotify, song);
        if (!spotifyTrack) {
          runSeenSongKeys.add(songKey);
          stats.songsUnmatched += 1;
          continue;
        }

        const matchedSongKey = buildSongKey(
          spotifyTrack.artists.map((artist) => artist.name).join(' '),
          spotifyTrack.name,
        );

        if (playlistIndex.trackIds.has(spotifyTrack.id)) {
          runSeenSongKeys.add(songKey);
          playlistIndex.songKeys.add(songKey);
          playlistIndex.songKeys.add(matchedSongKey);
          stats.songsAlreadyInPlaylistSkipped += 1;
          continue;
        }

        urisToAdd.push(spotifyTrack.uri);
        runSeenSongKeys.add(songKey);
        playlistIndex.trackIds.add(spotifyTrack.id);
        playlistIndex.songKeys.add(songKey);
        playlistIndex.songKeys.add(matchedSongKey);
        stats.songsMatched += 1;
      }

      if (!dryRun && urisToAdd.length > 0) {
        await spotify.addTracksToPlaylist(playlistId, urisToAdd.toReversed(), { position: 0 });
        stats.tracksAdded += urisToAdd.length;
      }

      if (!dryRun && isWindowFullyInPastInWarsaw(date, window.to)) {
        markWindowProcessed(state, stationId, date, windowKey);
        await saveState(state);
      } else if (!dryRun) {
        stats.windowsNotMarkedNotInPast += 1;
      }

      stats.windowsProcessed += 1;
      completedWindows += 1;
      progressReporter?.update({
        completed: completedWindows,
        total: windows.length,
        window,
        status: 'done',
      });

      if (sourceDelayMs > 0) {
        await delay(sourceDelayMs);
      }
    }

    progressReporter?.finish();
  } finally {
    progressReporter?.dispose();
  }

  printSyncSummary({
    stationId,
    date,
    playlistId,
    dryRun,
    force,
    stats,
  });
}

async function findTrackForSong(
  spotify: SpotifyClient,
  song: ScrapedSong,
): Promise<SpotifyTrack | null> {
  const queryParts: string[] = [];
  if (song.title) {
    queryParts.push(`track:${song.title}`);
  }
  if (song.artist) {
    queryParts.push(`artist:${song.artist}`);
  }

  const query = queryParts.join(' ').trim() || song.rawLabel;
  const candidates = await spotify.searchTracks(query, 10);

  if (candidates.length === 0) {
    return null;
  }

  return chooseBestTrack(song, candidates);
}

function chooseBestTrack(song: ScrapedSong, candidates: SpotifyTrack[]): SpotifyTrack {
  const expectedTitle = normalize(song.title);
  const expectedArtist = normalize(song.artist);

  const scored = candidates.map((track) => {
    const trackTitle = normalize(track.name);
    const trackArtists = track.artists
      .map((artist) => normalize(artist.name))
      .filter((artist) => artist.length > 0);

    let score = 0;

    if (trackTitle === expectedTitle) {
      score += 120;
    } else if (trackTitle.includes(expectedTitle) || expectedTitle.includes(trackTitle)) {
      score += 75;
    }

    if (expectedArtist) {
      const hasArtistMatch = trackArtists.some(
        (artist) =>
          artist === expectedArtist ||
          artist.includes(expectedArtist) ||
          expectedArtist.includes(artist),
      );
      if (hasArtistMatch) {
        score += 100;
      }
    }

    if (track.album.album_type === 'album') {
      score += 28;
    }

    if (track.album.album_type === 'single') {
      score -= 12;
    }

    score += Math.min(track.popularity ?? 0, 100) / 15;

    return { track, score };
  });

  if (scored.length === 0) {
    throw new Error('No candidate tracks available to score.');
  }

  const sortedByScore = scored.toSorted((a, b) => b.score - a.score);

  const best = sortedByScore[0];
  if (!best) {
    throw new Error('No scored tracks available.');
  }

  const bestAlbumCandidate = sortedByScore.find(
    (candidate) => candidate.track.album.album_type === 'album',
  );

  if (
    bestAlbumCandidate &&
    best.track.album.album_type === 'single' &&
    bestAlbumCandidate.score >= best.score - 12
  ) {
    return bestAlbumCandidate.track;
  }

  return best.track;
}

async function loadState(): Promise<State> {
  try {
    const stateRaw = await fs.readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(stateRaw) as Partial<State>;

    return {
      version: APP_VERSION,
      stationPlaylists: parsed.stationPlaylists ?? {},
      scrapedWindows: parsed.scrapedWindows ?? {},
    };
  } catch {
    return {
      version: APP_VERSION,
      stationPlaylists: {},
      scrapedWindows: {},
    };
  }
}

async function saveState(state: State): Promise<void> {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function isWindowAlreadyProcessed(
  state: State,
  stationId: string,
  date: string,
  windowKey: string,
): boolean {
  return Boolean(state.scrapedWindows[stationId]?.[date]?.[windowKey]);
}

function markWindowProcessed(
  state: State,
  stationId: string,
  date: string,
  windowKey: string,
): void {
  state.scrapedWindows[stationId] ??= {};
  state.scrapedWindows[stationId][date] ??= {};
  state.scrapedWindows[stationId][date][windowKey] = true;
}

class WindowProgressReporter {
  private readonly spinner: Spinner | null;
  private readonly total: number;

  constructor(total: number) {
    this.total = total;
    this.spinner = process.stdout.isTTY ? createSpinner('Preparing scrape windows…').start() : null;
  }

  update(input: WindowProgressInput): void {
    const text = formatWindowProgressText(input);

    if (this.spinner) {
      this.spinner.update({ text });
      return;
    }

    console.log(text);
  }

  finish(): void {
    if (!this.spinner) {
      return;
    }

    this.spinner.success({
      text: `Scrape windows complete (${this.total}/${this.total}).`,
      update: true,
    });
  }

  dispose(): void {
    if (!this.spinner || !this.spinner.isSpinning()) {
      return;
    }

    this.spinner.stop();
  }
}

async function resolveStationLabelForSync(stationId: string): Promise<string> {
  try {
    const stations = await fetchStationsFromOdsluchane();
    const station = stations.find((stationItem) => stationItem.id === stationId);
    if (!station) {
      return `station ${stationId}`;
    }

    return `${station.name} (${station.id})`;
  } catch {
    return `station ${stationId}`;
  }
}

async function resolveStationForSync(
  args: ParsedArgs,
): Promise<{ stationId: string; stationLabel: string }> {
  const stationIdArg = typeof args.station === 'string' ? args.station.trim() : '';

  if (stationIdArg) {
    const stationLabel = await resolveStationLabelForSync(stationIdArg);
    return {
      stationId: stationIdArg,
      stationLabel,
    };
  }

  const stationName =
    typeof args['station-name'] === 'string' ? cleanupSpaces(args['station-name']) : '';

  if (!stationName) {
    throw new Error('Missing required argument: --station or --station-name');
  }

  const stations = await fetchStationsFromOdsluchane();
  const stationOptions = stations.map((stationItem) => ({
    id: stationItem.id,
    label: stationItem.name,
    searchText: `${stationItem.name} ${stationItem.groupName} ${stationItem.id}`,
  }));
  const matchingStations = filterSelectOptionsByName(stationOptions, stationName);

  if (matchingStations.length === 0) {
    throw new Error(`No station matches --station-name "${stationName}".`);
  }

  if (matchingStations.length > 1) {
    throw new Error(
      `--station-name "${stationName}" matched ${matchingStations.length} stations. Refine the name or use --station <id>.`,
    );
  }

  const station = matchingStations[0];
  if (!station) {
    throw new Error('Station selection failed unexpectedly.');
  }

  const stationLabel = `${station.label} (${station.id})`;
  console.log(`Sync station: auto-selected by --station-name "${stationName}" -> ${stationLabel}`);

  return {
    stationId: station.id,
    stationLabel,
  };
}

function printHelp(): void {
  console.log(`
odsluchane-to-spotify

Commands:
  auth          Start local callback listener, open URL, and exchange code automatically
  map           Save station ID -> playlist ID mapping (interactive if flags omitted)
  sync          Scrape odsluchane and add matched tracks to Spotify

Examples:
  yarn auth
  yarn map
  yarn map --station-name chill --playlist-name chill
  yarn map --station 40 --playlist 37i9dQZF1DX…
  yarn sync --station 40
  yarn sync --station-name chill --date 24-02-2026
  yarn sync --station 40 --from 0 --to 24 --window 2

map options:
  --station <id>            non-interactive mode
  --playlist <id|url>       non-interactive mode
  --station-name <name>     filter station list by name; auto-select if exactly one match
  --playlist-name <name>    filter playlist list by name; auto-select if exactly one match

sync options:
  --station <id>            required unless --station-name is provided
  --station-name <name>     station name filter; auto-select if exactly one match
  --playlist <id|url>       optional (also saves mapping)
  --date <DD-MM-YYYY>       default: today in Europe/Warsaw
  --from <0-23>             default: 0
  --to <1-24>               default: 24
  --window <1|2>            default: 2 (source max)
  --source-delay-ms <ms>    default: 2500
  --spotify-delay-ms <ms>   default: 120
  --dry-run                 don't add tracks, only report
  --force                   ignore processed-window memory

auth options:
  --timeout-ms <ms>         default: 180000
`);
}

function printSyncSummary(input: SyncSummaryInput): void {
  console.log('\nSync finished');
  console.log(`Station: ${input.stationId}`);
  console.log(`Date: ${input.date}`);
  console.log(`Playlist: ${input.playlistId}`);
  console.log(`Dry run: ${input.dryRun}`);
  console.log(`Force: ${input.force}`);
  console.log('');
  console.log(`Windows planned: ${input.stats.windowsPlanned}`);
  console.log(`Windows processed: ${input.stats.windowsProcessed}`);
  console.log(`Windows skipped (already done): ${input.stats.windowsSkippedAlreadyDone}`);
  console.log(`Windows skipped (fully in future): ${input.stats.windowsSkippedFuture}`);
  console.log(`Windows not marked (not fully in past): ${input.stats.windowsNotMarkedNotInPast}`);
  console.log(`Songs scraped: ${input.stats.songsScraped}`);
  console.log(`Songs matched: ${input.stats.songsMatched}`);
  console.log(`Songs unmatched: ${input.stats.songsUnmatched}`);
  console.log(`Songs skipped (duplicates in run): ${input.stats.songsDuplicateSkipped}`);
  console.log(`Songs skipped (already in playlist): ${input.stats.songsAlreadyInPlaylistSkipped}`);
  console.log(`Tracks added: ${input.stats.tracksAdded}`);
  console.log(`State file: ${STATE_PATH}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
