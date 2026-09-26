import { describe, it, expect, beforeEach } from 'vitest';
import { dedupeInflight, resetInflightDedupe } from './inflightDedupe.js';

beforeEach(() => {
    resetInflightDedupe();
});

describe('dedupeInflight', () => {
    it('shares one pending promise across parallel callers with the same key', async () => {
        let calls = 0;
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const fn = async () => {
            calls += 1;
            await gate;
            return { ok: true };
        };

        const a = dedupeInflight('k', fn);
        const b = dedupeInflight('k', fn);
        release();

        expect(await a).toEqual({ ok: true });
        expect(await b).toEqual({ ok: true });
        expect(calls).toBe(1);
    });

    it('does not cache after settle — the next call refetches', async () => {
        let calls = 0;
        const fn = async () => ({ seq: ++calls });

        await dedupeInflight('k', fn);
        const second = await dedupeInflight('k', fn);

        expect(second.seq).toBe(2);
        expect(calls).toBe(2);
    });

    it('clears the slot when the work rejects so retries can proceed', async () => {
        let calls = 0;
        const fn = async () => {
            calls += 1;
            if (calls === 1) throw new Error('boom');
            return 'ok';
        };

        await expect(dedupeInflight('k', fn)).rejects.toThrow('boom');
        await expect(dedupeInflight('k', fn)).resolves.toBe('ok');
        expect(calls).toBe(2);
    });

    it('keeps different keys independent', async () => {
        let calls = 0;
        const fn = async () => { calls += 1; return calls; };

        const a = dedupeInflight('one', fn);
        const b = dedupeInflight('two', fn);

        expect(await a).toBe(1);
        expect(await b).toBe(2);
        expect(calls).toBe(2);
    });
});
