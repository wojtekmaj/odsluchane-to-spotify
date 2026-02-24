export function cleanupSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\bfeat\.?\b.*$/gi, ' ')
    .replace(/\bft\.?\b.*$/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildSongKey(artist: string, title: string): string {
  return `${normalize(artist)}|${normalize(title)}`;
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}
