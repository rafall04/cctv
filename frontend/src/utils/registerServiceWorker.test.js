/*
 * Purpose: Verify the PWA offers a new version and reloads ONLY when the visitor accepts.
 * Caller: Frontend focused PWA registration test gate.
 * Deps: Vitest and registerServiceWorker.
 * MainFuncs: registerServiceWorker tests.
 * SideEffects: Mocks navigator.serviceWorker, window, and document listeners.
 *
 * These assertions are the inverse of the ones they replace, deliberately. The old contract was
 * "a new controller reloads the page"; reproduced on a real build, that fired ~3s after the visitor
 * came back and ran the page briefly on a mismatched build. The contract is now "never reload
 * unless asked".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, SW_UPDATE_READY_EVENT } from './registerServiceWorker';

function stubServiceWorker({ controller = null, waiting = null } = {}) {
    const swListeners = {};
    const regListeners = {};
    const reload = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    const dispatched = [];

    const registration = {
        scope: '/',
        update,
        waiting,
        installing: null,
        addEventListener: vi.fn((type, handler) => { regListeners[type] = handler; }),
    };

    vi.stubGlobal('window', {
        location: { reload },
        dispatchEvent: vi.fn((event) => { dispatched.push(event); return true; }),
    });
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn() });
    vi.stubGlobal('navigator', {
        serviceWorker: {
            controller,
            register: vi.fn().mockResolvedValue(registration),
            addEventListener: vi.fn((type, handler) => { swListeners[type] = handler; }),
        },
    });

    return { swListeners, regListeners, registration, reload, update, dispatched };
}

/** The event the UI listens for, or undefined if none was announced. */
const updateOffer = (dispatched) => dispatched.find((e) => e.type === SW_UPDATE_READY_EVENT);

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

    it('never reloads on its own, even when a new worker takes control', async () => {
        const { swListeners, reload } = stubServiceWorker({ controller: {} });
        await registerServiceWorker();

        swListeners.controllerchange();
        swListeners.controllerchange();

        expect(reload).not.toHaveBeenCalled();
    });

    it('offers an update that is already waiting from a previous visit', async () => {
        const waiting = { postMessage: vi.fn() };
        const { dispatched } = stubServiceWorker({ controller: {}, waiting });
        await registerServiceWorker();

        expect(updateOffer(dispatched)).toBeTruthy();
    });

    it('stays silent on a first install — a waiting worker with nothing to replace is not an update', async () => {
        const { dispatched } = stubServiceWorker({ controller: null, waiting: { postMessage: vi.fn() } });
        await registerServiceWorker();

        expect(updateOffer(dispatched)).toBeUndefined();
    });

    it('offers the update when one finishes installing mid-session', async () => {
        const { registration, regListeners, dispatched } = stubServiceWorker({ controller: {} });
        await registerServiceWorker();
        expect(updateOffer(dispatched)).toBeUndefined();

        const installing = { state: 'installing', addEventListener: vi.fn() };
        registration.installing = installing;
        regListeners.updatefound();

        // Only once it reaches "installed" (and is therefore waiting) is there anything to accept.
        registration.waiting = { postMessage: vi.fn() };
        installing.state = 'installed';
        installing.addEventListener.mock.calls[0][1]();

        expect(updateOffer(dispatched)).toBeTruthy();
    });

    it('reloads exactly once, and only after the visitor accepts', async () => {
        const waiting = { postMessage: vi.fn() };
        const { swListeners, dispatched, reload } = stubServiceWorker({ controller: {}, waiting });
        await registerServiceWorker();

        // Accepting asks the waiting worker to take over...
        updateOffer(dispatched).detail.apply();
        expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
        expect(reload).not.toHaveBeenCalled();

        // ...and only the takeover that follows reloads.
        swListeners.controllerchange();
        expect(reload).toHaveBeenCalledTimes(1);

        swListeners.controllerchange();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('re-checks for updates when the app regains focus', async () => {
        const { update } = stubServiceWorker({ controller: {} });
        await registerServiceWorker();

        const [type, handler] = document.addEventListener.mock.calls[0];
        expect(type).toBe('visibilitychange');
        handler();
        expect(update).toHaveBeenCalled();
    });
});
