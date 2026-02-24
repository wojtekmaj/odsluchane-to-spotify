import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { load } from 'cheerio';

import { fetchWithRetry } from '../common/fetch.ts';
import { cleanupSpaces, decodeHtmlEntities } from '../common/string.ts';

import type {
  ScrapedSong,
  SplitSongLabelResult,
  StationCatalogGroup,
  StationOption,
} from './types.ts';

const CACHE_DIR = path.join(process.cwd(), '.cache');

const STATIONS_CACHE_PATH = path.join(CACHE_DIR, 'stations.json');

export async function fetchStationsFromOdsluchane(): Promise<StationOption[]> {
  const cachedStations = await readStationsCache();
  if (cachedStations) {
    return cachedStations;
  }

  const stations = await fetchStationsFromOdsluchaneSource();
  await writeStationsCache(stations);
  return stations;
}

async function fetchStationsFromOdsluchaneSource(): Promise<StationOption[]> {
  const response = await fetchWithRetry('https://www.odsluchane.eu/', {
    headers: {
      'User-Agent': 'odsluchane-to-spotify/1.0 (+respectful scraper)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch station catalog (${response.status}) from odsluchane.eu`);
  }

  const html = await response.text();
  const $ = load(html);
  const stationsRaw = $('selektor').first().attr(':stations-default');

  if (!stationsRaw) {
    throw new Error('Failed to parse station list from odsluchane.eu page.');
  }

  let groups: StationCatalogGroup[];
  try {
    groups = JSON.parse(decodeHtmlEntities(stationsRaw)) as StationCatalogGroup[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to decode station list JSON: ${message}`);
  }

  const stations: StationOption[] = [];

  for (const group of groups) {
    const groupName = cleanupSpaces(group.groupName);

    for (const station of group.stations) {
      const name = cleanupSpaces(station.name);
      const id = String(station.id).trim();

      if (!name || !id) {
        continue;
      }

      stations.push({
        id,
        name,
        groupName,
      });
    }
  }

  if (stations.length === 0) {
    throw new Error('Station list was fetched but no stations were found.');
  }

  return stations;
}

async function readStationsCache(): Promise<StationOption[] | null> {
  try {
    const raw = await fs.readFile(STATIONS_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return null;
    }

    const stations: StationOption[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const id = cleanupSpaces(String((item as Record<string, unknown>).id ?? ''));
      const name = cleanupSpaces(String((item as Record<string, unknown>).name ?? ''));
      const groupName = cleanupSpaces(String((item as Record<string, unknown>).groupName ?? ''));

      if (!id || !name || !groupName) {
        return null;
      }

      stations.push({ id, name, groupName });
    }

    return stations.length > 0 ? stations : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }

    return null;
  }
}

async function writeStationsCache(stations: StationOption[]): Promise<void> {
  await fs.mkdir(path.dirname(STATIONS_CACHE_PATH), { recursive: true });
  await fs.writeFile(STATIONS_CACHE_PATH, `${JSON.stringify(stations, null, 2)}\n`, 'utf8');
}

export function buildSourceUrl(
  stationId: string,
  date: string,
  timeFrom: number,
  timeTo: number,
): string {
  const params = new URLSearchParams({
    r: stationId,
    date,
    time_from: String(timeFrom),
    time_to: String(timeTo),
  });

  return `https://www.odsluchane.eu/szukaj.php?${params.toString()}`;
}

export async function scrapeSongsFromSource(sourceUrl: string): Promise<ScrapedSong[]> {
  const response = await fetchWithRetry(sourceUrl, {
    headers: {
      'User-Agent': 'odsluchane-to-spotify/1.0 (+respectful scraper)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch source page (${response.status}): ${sourceUrl}`);
  }

  const html = await response.text();
  const $ = load(html);
  const rows = $('table tbody tr').toArray();
  const songs: ScrapedSong[] = [];

  for (const row of rows) {
    const cells = $(row).find('td');
    if (cells.length < 2) {
      continue;
    }

    const titleCell = $(cells[1]);
    const titleLink = titleCell.find('a.title-link').first();
    const rawLabel = cleanupSpaces(titleLink.text() || titleCell.text());

    if (!rawLabel) {
      continue;
    }

    const playedAt = cleanupSpaces($(cells[0]).text());

    if (!playedAt || playedAt.length > 5 || !playedAt.includes(':')) {
      continue;
    }

    const parsed = splitSongLabel(rawLabel);

    songs.push({
      playedAt,
      rawLabel,
      artist: parsed.artist,
      title: parsed.title,
      sourceUrl,
    });
  }

  return songs;
}

function splitSongLabel(rawLabel: string): SplitSongLabelResult {
  const separators = [' - ', ' – ', ' — '];

  for (const separator of separators) {
    const index = rawLabel.indexOf(separator);
    if (index > 0) {
      return {
        artist: rawLabel.slice(0, index).trim(),
        title: rawLabel.slice(index + separator.length).trim(),
      };
    }
  }

  return {
    artist: '',
    title: rawLabel.trim(),
  };
}
