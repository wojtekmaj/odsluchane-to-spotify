export type SpotifyArtist = {
  name: string;
};

export type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  artists: SpotifyArtist[];
  popularity: number;
  album: {
    album_type: string;
    name: string;
  };
};

export type PlaylistTrackItem = {
  track?: SpotifyTrack | null;
  item?: SpotifyTrack | null;
};

export type SpotifySearchResponse = {
  tracks: {
    items: SpotifyTrack[];
  };
};

export type PlaylistTracksResponse = {
  items: PlaylistTrackItem[];
  next: string | null;
};

export type SpotifyPlaylistSummary = {
  id: string;
  name: string;
  collaborative: boolean;
  public: boolean | null;
  owner: {
    id: string;
    display_name: string | null;
  };
  tracks: {
    total: number;
  };
};

export type SpotifyUserPlaylistsResponse = {
  items: SpotifyPlaylistSummary[];
  next: string | null;
};

export type PlaylistOption = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  tracksTotal: number;
  collaborative: boolean;
  isPublic: boolean | null;
};

export type SpotifyCurrentUser = {
  id: string;
  display_name: string | null;
};

export type SpotifyPlaylistMeta = {
  id: string;
  name: string;
  collaborative: boolean;
  public: boolean | null;
  owner: {
    id: string;
    display_name: string | null;
  };
};

export type SpotifyAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export type SpotifyPlaylistTrackIndex = {
  trackIds: Set<string>;
  songKeys: Set<string>;
};

export type AddTracksToPlaylistOptions = {
  position?: number;
};
