/*
 * Purpose: Verify public PWA service worker registration + forced auto-reload on a new controller.
 * Caller: Frontend focused PWA registration test gate.
 * Deps: Vitest and registerServiceWorker.
 * MainFuncs: registerServiceWorker tests.
 * SideEffects: Mocks navigator.serviceWorker, window.location.reload, and document listeners.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './registerServiceWorker';

function stubServiceWorker({ controller = null } = {}) {
    const swListeners = {};
    const reload = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { location: { reload } });
    vi.stubGlobal('document', {
        visibilityState: 'visible',
        addEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', {
        serviceWorker: {
            controller,
            register: vi.fn().mockResolvedValue({ scope: '/', update }),
            addEventListener: vi.fn((type, handler) => { swListeners[type] = handler; }),
        },
    });
    return { swListeners, reload, update };
}

describe('registerServiceWorker', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    it('registers the root service worker when service workers are available', async () => {
        stubServiceWorker();
        await registerServiceWorker();
        expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    });

    it('does not throw when service workers are unavailable', async () => {
        vi.stubGlobal('navigator', {});
        await expect(registerServiceWorker()).resolves.toBeUndefined();
    });

    it('swallows the first controllerchange on a first-visit (uncontrolled) page, reloads on the next', async () => {
        const { swListeners, reload } = stubServiceWorker({ controller: null });
        await registerServiceWorker();

        // First claim of a previously-uncontrolled page = initial takeover, not an update.
        swListeners.controllerchange();
        expect(reload).not.toHaveBeenCalled();

        // A later controllerchange = a real deploy landed → reload.
        swListeners.controllerchange();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('reloads on the first controllerchange when the page was already controlled (return visit)', async () => {
        const { swListeners, reload } = stubServiceWorker({ controller: {} });
        await registerServiceWorker();

        swListeners.controllerchange();
        expect(reload).toHaveBeenCalledTimes(1);

        // Guard against reload loops: further events do not reload again.
        swListeners.controllerchange();
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
