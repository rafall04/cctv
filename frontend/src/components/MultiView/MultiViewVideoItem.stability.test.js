/*
Purpose: Guard the multi-view HLS player against lifecycle regressions that cause intermittent stream errors.
Caller: Vitest frontend component stability suite.
Deps: Node fs/path/url, MultiViewVideoItem source.
MainFuncs: MultiViewVideoItem source stability tests.
SideEffects: Reads component source from disk.
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(dirname, 'MultiViewVideoItem.jsx'), 'utf8');

function getHlsEffectDependencies() {
    const start = source.indexOf('        initStream();');
    const dependencyStart = source.indexOf('    }, [', start);
    const dependencyEnd = source.indexOf('    ]);', dependencyStart);

    return source.slice(dependencyStart, dependencyEnd);
}

describe('MultiViewVideoItem HLS stability', () => {
    it('does not restart the HLS effect from transient loading state changes', () => {
        const dependencies = getHlsEffectDependencies();

        expect(dependencies).not.toContain('loadingStage');
        expect(dependencies).not.toContain('autoRetryCount');
    });

    it('does not read stream timeout callbacks before their hook declaration', () => {
        const firstClearTimeoutDependency = source.indexOf('[clearStreamTimeout]');
        const streamTimeoutDeclaration = source.indexOf('clearTimeout: clearStreamTimeout');

        expect(firstClearTimeoutDependency).toBeGreaterThan(streamTimeoutDeclaration);
    });

    it('guards delayed viewer session startup so unmounted tiles do not leak sessions', () => {
        expect(source).toContain('let isActive = true;');
        expect(source).toContain('if (!isActive)');
        expect(source).toContain('isActive = false;');
    });

    it('retries internal HLS manifest warmup errors before surfacing tile failure', () => {
        expect(source).toContain('internalWarmupRetryCountRef');
        expect(source).toContain('manifestLoadError');
        expect(source).toContain('levelLoadError');
        expect(source).toContain('setRetryKey((current) => current + 1)');
    });
});
