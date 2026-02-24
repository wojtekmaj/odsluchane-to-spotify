import { describe, expect, it } from 'vitest';

import { formatDuration, parseInputDate } from './date.ts';

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(60)).toBe('1m 0s');
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('formats hours, minutes and seconds', () => {
    expect(formatDuration(3600)).toBe('1h 0m 0s');
    expect(formatDuration(3661)).toBe('1h 1m 1s');
  });

  it('normalizes invalid inputs to zero duration', () => {
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(Number.NaN)).toBe('0s');
  });
});

describe('parseInputDate', () => {
  it('accepts valid calendar date', () => {
    expect(parseInputDate('24-02-2026')).toEqual({ day: 24, month: 2, year: 2026 });
  });

  it('accepts leap day for leap year', () => {
    expect(parseInputDate('29-02-2024')).toEqual({ day: 29, month: 2, year: 2024 });
  });

  it('rejects impossible calendar date', () => {
    expect(() => parseInputDate('31-02-2026')).toThrow('Invalid calendar date');
  });

  it('rejects leap day for non-leap year', () => {
    expect(() => parseInputDate('29-02-2026')).toThrow('Invalid calendar date');
  });

  it('rejects invalid format', () => {
    expect(() => parseInputDate('2026-02-24')).toThrow('Invalid date format');
  });
});
