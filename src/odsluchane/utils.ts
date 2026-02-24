import { parseInputDate } from '../common/date.ts';

import type { WarsawNowParts } from './types.ts';

export function getTodayDateInWarsaw(): string {
  const errorMessage = 'Failed to determine current date in Europe/Warsaw timezone.';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date());

  const day = getNumericPartByName(parts, 'day', errorMessage);
  const month = getNumericPartByName(parts, 'month', errorMessage);
  const year = getNumericPartByName(parts, 'year', errorMessage);

  return `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${String(year).padStart(4, '0')}`;
}

export function isWindowFullyInPastInWarsaw(date: string, windowToHour: number): boolean {
  const nowParts = getNowInWarsawParts();
  const targetDate = parseInputDate(date);

  const todayKey = dateKey(nowParts.year, nowParts.month, nowParts.day);
  const targetKey = dateKey(targetDate.year, targetDate.month, targetDate.day);

  if (targetKey < todayKey) {
    return true;
  }

  if (targetKey > todayKey) {
    return false;
  }

  const nowMinutes = nowParts.hour * 60 + nowParts.minute;
  const windowEndMinutes = windowToHour * 60;
  return nowMinutes >= windowEndMinutes;
}

export function isWindowFullyInFutureInWarsaw(date: string, windowFromHour: number): boolean {
  const nowParts = getNowInWarsawParts();
  const targetDate = parseInputDate(date);

  const todayKey = dateKey(nowParts.year, nowParts.month, nowParts.day);
  const targetKey = dateKey(targetDate.year, targetDate.month, targetDate.day);

  if (targetKey > todayKey) {
    return true;
  }

  if (targetKey < todayKey) {
    return false;
  }

  const nowMinutes = nowParts.hour * 60 + nowParts.minute;
  const windowStartMinutes = windowFromHour * 60;
  return windowStartMinutes > nowMinutes;
}

function getNowInWarsawParts(): WarsawNowParts {
  const errorMessage = 'Failed to determine current date/time in Europe/Warsaw timezone.';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const day = getNumericPartByName(parts, 'day', errorMessage);
  const month = getNumericPartByName(parts, 'month', errorMessage);
  const year = getNumericPartByName(parts, 'year', errorMessage);
  const hour = getNumericPartByName(parts, 'hour', errorMessage);
  const minute = getNumericPartByName(parts, 'minute', errorMessage);

  return { year, month, day, hour, minute };
}

function getNumericPartByName(
  parts: Intl.DateTimeFormatPart[],
  partName: 'day' | 'month' | 'year' | 'hour' | 'minute',
  errorMessage: string,
): number {
  const partValue = parts.find((part) => part.type === partName)?.value;
  if (!partValue) {
    throw new Error(errorMessage);
  }

  const parsedValue = Number.parseInt(partValue, 10);
  if (Number.isNaN(parsedValue)) {
    throw new Error(errorMessage);
  }

  return parsedValue;
}

function dateKey(year: number, month: number, day: number): number {
  return year * 10_000 + month * 100 + day;
}
