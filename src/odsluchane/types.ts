export type ScrapedSong = {
  playedAt: string;
  rawLabel: string;
  artist: string;
  title: string;
  sourceUrl: string;
};

export type StationCatalogGroup = {
  groupName: string;
  stations: Array<{
    id: number | string;
    name: string;
  }>;
};

export type StationOption = {
  id: string;
  name: string;
  groupName: string;
};

export type SplitSongLabelResult = {
  artist: string;
  title: string;
};

export type WarsawNowParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};
