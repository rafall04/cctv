/*
Purpose: Verify multi-view stream init queue policy stays active across device tiers.
Caller: Vitest frontend utility suite.
Deps: streamInitQueue utility.
MainFuncs: shouldUseQueuedInit tests.
SideEffects: None.
*/

import { describe, expect, it } from 'vitest';
import { shouldUseQueuedInit } from './streamInitQueue.js';

describe('streamInitQueue policy', () => {
    it('uses queued initialization on every device tier for stable multi-view startup', () => {
        expect(shouldUseQueuedInit({ tier: 'low' })).toBe(true);
        expect(shouldUseQueuedInit({ tier: 'medium' })).toBe(true);
        expect(shouldUseQueuedInit({ tier: 'high' })).toBe(true);
    });
});
