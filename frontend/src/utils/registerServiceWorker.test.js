/*
 * Purpose: Verify public PWA service worker registration is safe and production-only.
 * Caller: Frontend focused PWA registration test gate.
 * Deps: Vitest and registerServiceWorker.
 * MainFuncs: registerServiceWorker tests.
 * SideEffects: Mocks navigator.serviceWorker and import.meta environment shape.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './registerServiceWorker';

describe('registerServiceWorker', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {});
        vi.stubGlobal('navigator', {
            serviceWorker: {
                register: vi.fn().mockResolvedValue({ scope: '/' }),
            },
        });
    });

    it('registers the root service worker when service workers are available', async () => {
        await registerServiceWorker();
        expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    });

    it('does not throw when service workers are unavailable', async () => {
        vi.stubGlobal('navigator', {});
        await expect(registerServiceWorker()).resolves.toBeUndefined();
    });
});
