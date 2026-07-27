/*
 * Purpose: Lock the byte-range parsing that makes archive playback seekable.
 * Caller: Backend Vitest suite.
 * Deps: services/telegramArchiveLibraryService (pure parseRange only).
 * MainFuncs: parseRange assertions.
 * SideEffects: None.
 *
 * Reported from the field: playback worked but the scrubber did nothing — no skip forward, no jump
 * to a minute. The endpoint answered 200 with the whole file and never advertised Accept-Ranges,
 * so the browser had no way to ask for the middle of a segment.
 */

import { describe, expect, it } from 'vitest';
import { parseRange } from '../services/telegramArchiveLibraryService.js';

const SIZE = 1000;

describe('parseRange', () => {
    it('reads the normal closed form a player sends when seeking', () => {
        expect(parseRange('bytes=100-199', SIZE)).toEqual({ start: 100, end: 199 });
    });

    it('treats an open end as "to the end of the file"', () => {
        expect(parseRange('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 });
    });

    it('supports the suffix form — players use it to read an MP4 index stored at the end', () => {
        expect(parseRange('bytes=-500', SIZE)).toEqual({ start: 500, end: 999 });
    });

    it('clamps an end past the file rather than promising bytes that do not exist', () => {
        expect(parseRange('bytes=900-99999', SIZE)).toEqual({ start: 900, end: 999 });
    });

    it('returns null for anything it cannot honour, so the caller falls back to a full 200', () => {
        expect(parseRange(undefined, SIZE)).toBeNull();
        expect(parseRange('bytes=abc', SIZE)).toBeNull();
        expect(parseRange('items=0-10', SIZE)).toBeNull();
        expect(parseRange('bytes=900-100', SIZE)).toBeNull(); // start after end
        expect(parseRange('bytes=5000-6000', SIZE)).toBeNull(); // starts past the file
        expect(parseRange('bytes=0-99', 0)).toBeNull(); // unknown size
    });
});
