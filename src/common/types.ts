export type ParsedArgs = {
  _: string[];
} & Record<string, string | boolean | string[]>;

export type State = {
  version: number;
  stationPlaylists: Record<string, string>;
  scrapedWindows: Record<string, Record<string, Record<string, true>>>;
};

export type PlaylistIndexCacheEntry = {
  snapshotId: string;
  trackIds: string[];
  songKeys: string[];
};

export type PlaylistIndexCache = Record<string, PlaylistIndexCacheEntry>;

export type SearchCacheEntry = {
  trackId: string | null;
  trackUri: string | null;
  matchedSongKey: string | null;
  updatedAt: number;
};

export type SearchCache = Record<string, SearchCacheEntry>;

export type SyncStats = {
  windowsPlanned: number;
  windowsSkippedAlreadyDone: number;
  windowsSkippedFuture: number;
  windowsProcessed: number;
  windowsNotMarkedNotInPast: number;
  songsScraped: number;
  songsDuplicateSkipped: number;
  songsAlreadyInPlaylistSkipped: number;
  songsMatched: number;
  songsUnmatched: number;
  tracksAdded: number;
  spotifySearchRequests: number;
  spotifySearchCacheHits: number;
  playlistIndexLoadedFromCache: boolean;
};

export type SelectOption = {
  id: string;
  label: string;
  searchText: string;
};

export type TimeWindow = {
  from: number;
  to: number;
};

export type WindowProgressStatus = 'waiting' | 'scraping' | 'skipped' | 'future' | 'done';

export type WindowProgressInput = {
  completed: number;
  total: number;
  window: TimeWindow;
  status: WindowProgressStatus;
};

export type WaitForAuthorizationCodeInput = {
  hostname: string;
  port: number;
  callbackPath: string;
  timeoutMs: number;
};

export type OAuthCallbackRequestInput = {
  hostname: string;
  port: number;
  callbackPath: string;
};

export type SyncSummaryInput = {
  stationId: string;
  date: string;
  playlistId: string;
  dryRun: boolean;
  force: boolean;
  stats: SyncStats;
};
