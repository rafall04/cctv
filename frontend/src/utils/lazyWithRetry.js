import { lazy } from 'react';

function isRecoverableDynamicImportError(error) {
    const message = String(error?.message || error || '');
    return (
        message.includes('Failed to fetch dynamically imported module')
        || message.includes('Importing a module script failed')
        || message.includes('ChunkLoadError')
        || message.includes('error loading dynamically imported module')
    );
}

export function lazyWithRetry(importer, key) {
    return lazy(async () => {
        try {
            const module = await importer();
            if (typeof window !== 'undefined' && window.sessionStorage) {
                window.sessionStorage.removeItem(`lazy-retry:${key}`);
            }
            return module;
        } catch (error) {
            const canUseBrowserRecovery = typeof window !== 'undefined' && window.sessionStorage;
            const storageKey = `lazy-retry:${key}`;
            const hasRetried = canUseBrowserRecovery && window.sessionStorage.getItem(storageKey) === '1';

            if (canUseBrowserRecovery && isRecoverableDynamicImportError(error) && !hasRetried) {
                window.sessionStorage.setItem(storageKey, '1');
                window.location.reload();
                return new Promise(() => {});
            }

            if (canUseBrowserRecovery) {
                window.sessionStorage.removeItem(storageKey);
            }

            throw error;
        }
    });
}

export default lazyWithRetry;
