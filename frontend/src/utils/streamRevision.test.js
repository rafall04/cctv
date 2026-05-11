/**
 * Purpose: Tests HLS stream revision cache-busting URL helper.
 * Caller: Frontend Vitest suite for VideoPlayer source reload behavior.
 * Deps: Vitest, streamRevision utility.
 * MainFuncs: appendStreamRevision test cases.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { appendStreamRevision } from './streamRevision';

describe('appendStreamRevision', () => {
    it('leaves empty urls untouched', () => {
        expect(appendStreamRevision('', 4)).toBe('');
    });

    it('adds stream_rev to urls without query strings', () => {
        expect(appendStreamRevision('/hls/camera_1/index.m3u8', 4))
            .toBe('/hls/camera_1/index.m3u8?stream_rev=4');
    });

    it('updates existing query strings without dropping params', () => {
        expect(appendStreamRevision('/hls/camera_1/index.m3u8?token=abc', 4))
            .toBe('/hls/camera_1/index.m3u8?token=abc&stream_rev=4');
    });
});
