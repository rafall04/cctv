/**
 * Purpose: Focused regression tests for API key public/protected endpoint classification.
 * Caller: Vitest backend verification for middleware security routing.
 * Deps: ../middleware/apiKeyValidator.js.
 * MainFuncs: isPublicEndpoint public growth whitelist coverage.
 * SideEffects: None; test-only assertions.
 */

import { describe, expect, it } from 'vitest';
import { isPublicEndpoint } from '../middleware/apiKeyValidator.js';

describe('apiKeyValidator public endpoint classification', () => {
    it('treats public growth endpoints as public reads', () => {
        expect(isPublicEndpoint('/api/public/areas/kab-surabaya')).toBe(true);
        expect(isPublicEndpoint('/api/public/areas/kab-surabaya/cameras?page=1')).toBe(true);
        expect(isPublicEndpoint('/api/public/trending-cameras?limit=4')).toBe(true);
    });

    it('keeps protected admin endpoints behind API key validation', () => {
        expect(isPublicEndpoint('/api/admin/dashboard')).toBe(false);
    });
});
