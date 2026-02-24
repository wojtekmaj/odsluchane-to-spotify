type ParsedInputDate = {
  day: number;
  month: number;
  year: number;
};

const DATE_PATTERN = /^\d{2}-\d{2}-\d{4}$/;

export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.round(totalSeconds)) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

export function parseInputDate(date: string): ParsedInputDate {
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`Invalid date format: ${date}. Expected DD-MM-YYYY.`);
  }

  const [dayRaw, monthRaw, yearRaw] = date.split('-');
  const day = Number.parseInt(dayRaw ?? '', 10);
  const month = Number.parseInt(monthRaw ?? '', 10);
  const year = Number.parseInt(yearRaw ?? '', 10);

  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) {
    throw new Error(`Invalid date format: ${date}. Expected DD-MM-YYYY.`);
  }

  const parsedDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  if (
    parsedDate.getUTCDate() !== day ||
    parsedDate.getUTCMonth() + 1 !== month ||
    parsedDate.getUTCFullYear() !== year
  ) {
    throw new Error(`Invalid calendar date: ${date}. Expected a real DD-MM-YYYY date.`);
  }

  return { day, month, year };
}
