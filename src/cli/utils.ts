import { parseArgs as parseNodeArgs } from 'node:util';

import { normalize } from '../common/string.ts';

import type { ParsedArgs, SelectOption, TimeWindow, WindowProgressInput } from '../common/types.ts';

export function parseCliArgs(argv: string[]): ParsedArgs {
  const parsed = { _: [] as string[] } as ParsedArgs;
  const options = {
    station: { type: 'string' },
    playlist: { type: 'string' },
    date: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    'station-name': { type: 'string' },
    'playlist-name': { type: 'string' },
    window: { type: 'string' },
    'source-delay-ms': { type: 'string' },
    'spotify-delay-ms': { type: 'string' },
    'dry-run': { type: 'boolean' },
    force: { type: 'boolean' },
    'timeout-ms': { type: 'string' },
  } as const;

  const result = parseNodeArgs({
    args: argv,
    options,
    allowPositionals: true,
    strict: false,
  });

  parsed._ = result.positionals;

  for (const [key, value] of Object.entries(result.values)) {
    if (typeof value === 'string' || typeof value === 'boolean') {
      parsed[key] = value;
    }
  }

  return parsed;
}

export function filterSelectOptionsByName<T extends SelectOption>(
  options: T[],
  nameFilter: string,
): T[] {
  if (!nameFilter) {
    return options;
  }

  const query = normalize(nameFilter);
  if (!query) {
    return options;
  }

  return options.filter((option) => normalize(option.searchText).includes(query));
}

export function buildStationGroupOptions(
  stationOptions: Array<SelectOption & { groupName: string }>,
): SelectOption[] {
  const groupCounts = new Map<string, number>();

  for (const stationOption of stationOptions) {
    groupCounts.set(stationOption.groupName, (groupCounts.get(stationOption.groupName) ?? 0) + 1);
  }

  return Array.from(groupCounts.entries())
    .map(([groupName, count]) => ({
      id: groupName,
      label: groupName,
      searchText: `${groupName} ${count}`,
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}

export function buildWindows(timeFrom: number, timeTo: number, windowHours: number): TimeWindow[] {
  const windows: TimeWindow[] = [];

  for (let from = timeFrom; from < timeTo; from += windowHours) {
    windows.push({
      from,
      to: Math.min(from + windowHours, timeTo),
    });
  }

  return windows;
}

export function formatWindowProgressText(input: WindowProgressInput): string {
  const { completed, total, window, status } = input;
  const percent = total === 0 ? 100 : Math.round((completed / total) * 100);
  const windowLabel = `${String(window.from).padStart(2, '0')}:00-${String(window.to).padStart(2, '0')}:00`;

  return `Scraping windows ${completed}/${total} (${percent}%) | ${windowLabel} | ${status}`;
}

export function normalizePlaylistId(playlist: string): string {
  const trimmed = playlist.trim();

  if (!trimmed.includes('spotify.com/playlist/')) {
    return trimmed;
  }

  const slashIndex = trimmed.indexOf('/playlist/');
  const withoutPrefix = trimmed.slice(slashIndex + '/playlist/'.length);
  const queryIndex = withoutPrefix.indexOf('?');

  return (queryIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, queryIndex)).trim();
}

export function readOptionalStringArg(args: ParsedArgs, argName: string): string | undefined {
  const rawValue = args[argName];

  if (rawValue === undefined) {
    return undefined;
  }

  if (typeof rawValue !== 'string') {
    throw new Error(`Invalid --${argName} value. Expected a string.`);
  }

  return rawValue;
}

export function parseIntegerString(rawValue: string, argName: string): number {
  const value = rawValue.trim();

  if (!/^-?\d+$/.test(value)) {
    throw new Error(`Invalid --${argName} value "${rawValue}". Expected an integer.`);
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid --${argName} value "${rawValue}". Expected a safe integer.`);
  }

  return parsed;
}

export function formatDdMmYyyyForDisplay(date: string): string {
  const [dayRaw, monthRaw, yearRaw] = date.split('-');
  const day = Number.parseInt(dayRaw ?? '', 10);
  const month = Number.parseInt(monthRaw ?? '', 10);
  const year = Number.parseInt(yearRaw ?? '', 10);

  if (
    Number.isNaN(day) ||
    Number.isNaN(month) ||
    Number.isNaN(year) ||
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12
  ) {
    return date;
  }

  const parsedDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsedDate);
}
