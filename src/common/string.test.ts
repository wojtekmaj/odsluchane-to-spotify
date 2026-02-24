import { describe, expect, it } from 'vitest';

import { buildSongKey, cleanupSpaces, decodeHtmlEntities, normalize } from './string.ts';

describe('cleanupSpaces', () => {
  it('collapses extra whitespace', () => {
    expect(cleanupSpaces('  A   lot   of   spaces  ')).toBe('A lot of spaces');
  });
});

describe('normalize', () => {
  it('normalizes case, accents and punctuation', () => {
    expect(normalize('  Béyoncé — Halo  ')).toBe('beyonce halo');
  });

  it('removes feature suffixes and bracketed fragments', () => {
    expect(normalize('Artist feat. Guest (Live) [Remix]')).toBe('artist');
    expect(normalize('Artist ft Guest - Song')).toBe('artist');
  });
});

describe('buildSongKey', () => {
  it('creates normalized artist-title composite key', () => {
    expect(buildSongKey('Beyoncé', 'Halo (Live)')).toBe('beyonce|halo');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named and numeric entities', () => {
    const encoded = '&quot;Tom &amp; Jerry&#039;s&#x20AC;&#8364;&quot;';
    expect(decodeHtmlEntities(encoded)).toBe('"Tom & Jerry\'s€€"');
  });
});
