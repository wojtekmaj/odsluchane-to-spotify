import { describe, expect, it } from 'vitest';

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

import type { ParsedArgs, SelectOption } from '../common/types.ts';

describe('parseCliArgs', () => {
  it('parses command, string args and flags', () => {
    const parsed = parseCliArgs([
      'sync',
      '--station',
      '40',
      '--dry-run',
      '--verbose',
      '--from',
      '2',
      '--station-name',
      'chill',
    ]);

    expect(parsed._).toEqual(['sync']);
    expect(parsed.station).toBe('40');
    expect(parsed['dry-run']).toBe(true);
    expect(parsed.verbose).toBe(true);
    expect(parsed.from).toBe('2');
    expect(parsed['station-name']).toBe('chill');
  });
});

describe('filterSelectOptionsByName', () => {
  it('filters options by normalized search text', () => {
    const options: SelectOption[] = [
      { id: '1', label: 'Chillizet', searchText: 'Chillizet Ogólnopolskie 40' },
      { id: '2', label: 'Rock', searchText: 'Antyradio Ogólnopolskie 5' },
    ];

    const filtered = filterSelectOptionsByName(options, 'chillizet ogolnopolskie');

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('1');
  });
});

describe('buildStationGroupOptions', () => {
  it('groups stations and sorts by label', () => {
    const options = [
      { id: '1', label: 'A', searchText: 'A', groupName: 'B Group' },
      { id: '2', label: 'B', searchText: 'B', groupName: 'A Group' },
      { id: '3', label: 'C', searchText: 'C', groupName: 'B Group' },
    ];

    const grouped = buildStationGroupOptions(options);

    expect(grouped).toEqual([
      { id: 'A Group', label: 'A Group', searchText: 'A Group 1' },
      { id: 'B Group', label: 'B Group', searchText: 'B Group 2' },
    ]);
  });
});

describe('buildWindows', () => {
  it('builds hour windows up to end range', () => {
    expect(buildWindows(0, 5, 2)).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
      { from: 4, to: 5 },
    ]);
  });
});

describe('formatWindowProgressText', () => {
  it('formats progress line', () => {
    expect(
      formatWindowProgressText({
        completed: 3,
        total: 12,
        window: { from: 6, to: 8 },
        status: 'scraping',
      }),
    ).toBe('Scraping windows 3/12 (25%) | 06:00-08:00 | scraping');
  });
});

describe('normalizePlaylistId', () => {
  it('keeps plain playlist id', () => {
    expect(normalizePlaylistId('37i9dQZF1DX123')).toBe('37i9dQZF1DX123');
  });

  it('extracts id from spotify playlist url', () => {
    expect(normalizePlaylistId('https://open.spotify.com/playlist/37i9dQZF1DX123?si=abcdef')).toBe(
      '37i9dQZF1DX123',
    );
  });
});

describe('readOptionalStringArg', () => {
  it('returns undefined for missing arg', () => {
    const args: ParsedArgs = { _: [] };
    expect(readOptionalStringArg(args, 'from')).toBeUndefined();
  });

  it('throws for non-string value', () => {
    const args: ParsedArgs = { _: [], from: true };
    expect(() => readOptionalStringArg(args, 'from')).toThrow(
      'Invalid --from value. Expected a string.',
    );
  });
});

describe('parseIntegerString', () => {
  it('parses valid integer values', () => {
    expect(parseIntegerString(' 42 ', 'from')).toBe(42);
    expect(parseIntegerString('-2', 'from')).toBe(-2);
  });

  it('throws on invalid integer values', () => {
    expect(() => parseIntegerString('2abc', 'from')).toThrow(
      'Invalid --from value "2abc". Expected an integer.',
    );
  });
});

describe('formatDdMmYyyyForDisplay', () => {
  it('formats valid date for display', () => {
    expect(formatDdMmYyyyForDisplay('24-02-2026')).toBe('February 24, 2026');
  });

  it('returns original value for invalid date parts', () => {
    expect(formatDdMmYyyyForDisplay('24-99-2026')).toBe('24-99-2026');
  });
});
