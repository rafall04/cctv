// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from 'vitest';
import { peekPrefetchedJson, resetEarlyPrefetch, takePrefetchedJson } from './earlyPrefetch.js';

describe('earlyPrefetch', () => {
    beforeEach(() => {
        resetEarlyPrefetch();
    });

    it('returns null when nothing was seeded', () => {
        expect(takePrefetchedJson('cameras')).toBeNull();
        expect(peekPrefetchedJson('cameras')).toBeNull();
    });

    it('take consumes once: first call gets the promise, later calls get null', async () => {
        window.__RAFNET_PREFETCH__ = { cameras: Promise.resolve({ success: true, data: [1] }) };

        const first = takePrefetchedJson('cameras');
        expect(first).not.toBeNull();
        expect(takePrefetchedJson('cameras')).toBeNull();
        await expect(first).resolves.toEqual({ success: true, data: [1] });
    });

    it('peek does not consume — a later take still receives the same promise', async () => {
        window.__RAFNET_PREFETCH__ = { branding: Promise.resolve({ success: true, data: { company_name: 'x' } }) };

        expect(peekPrefetchedJson('branding')).not.toBeNull();
        const taken = takePrefetchedJson('branding');
        expect(taken).not.toBeNull();
        await expect(taken).resolves.toEqual({ success: true, data: { company_name: 'x' } });
    });

    it('ignores non-thenable leftovers in the store', () => {
        window.__RAFNET_PREFETCH__ = { config: { not: 'a promise' } };

        expect(takePrefetchedJson('config')).toBeNull();
        expect(peekPrefetchedJson('config')).toBeNull();
    });
});
