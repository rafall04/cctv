// @vitest-environment node

/*
 * Purpose: Verify reconcileById preserves identity for unchanged records and the array reference when
 *          nothing changed, while never keeping a stale record.
 * Caller: Frontend Vitest suite.
 * Deps: Vitest, reconcileById util.
 * MainFuncs: shallowEqualRecord and reconcileById tests.
 * SideEffects: None.
 */

import { describe, it, expect } from 'vitest';
import { reconcileById, shallowEqualRecord } from './reconcileById';

describe('shallowEqualRecord', () => {
    it('is true for the same reference and for equal shallow fields', () => {
        const ref = { id: 1, value: 2 };
        expect(shallowEqualRecord(ref, ref)).toBe(true);
        expect(shallowEqualRecord({ id: 1, value: 2 }, { id: 1, value: 2 })).toBe(true);
    });

    it('is false when a field differs, keys differ, or a nested ref differs', () => {
        expect(shallowEqualRecord({ id: 1, value: 2 }, { id: 1, value: 3 })).toBe(false);
        expect(shallowEqualRecord({ id: 1 }, { id: 1, value: 3 })).toBe(false);
        // Different nested object references count as changed (no deep compare) — safe-by-default.
        expect(shallowEqualRecord({ id: 1, stats: {} }, { id: 1, stats: {} })).toBe(false);
    });
});

describe('reconcileById', () => {
    it('returns the same prev reference when content and order are unchanged', () => {
        const prev = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }];
        const next = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }];
        expect(reconcileById(prev, next)).toBe(prev);
    });

    it('preserves identity of unchanged items and uses fresh objects for changed ones', () => {
        const prev = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }];
        const next = [{ id: 1, v: 'a' }, { id: 2, v: 'B' }];
        const result = reconcileById(prev, next);

        expect(result).not.toBe(prev);
        expect(result[0]).toBe(prev[0]);
        expect(result[1]).toBe(next[1]);
    });

    it('treats reordering as changed but still reuses the original item identities', () => {
        const prev = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }];
        const next = [{ id: 2, v: 'b' }, { id: 1, v: 'a' }];
        const result = reconcileById(prev, next);

        expect(result).not.toBe(prev);
        expect(result[0]).toBe(prev[1]);
        expect(result[1]).toBe(prev[0]);
    });

    it('returns next when prev is empty', () => {
        const next = [{ id: 1 }];
        expect(reconcileById([], next)).toBe(next);
    });

    it('merges additions while keeping unchanged identities', () => {
        const prev = [{ id: 1, v: 'a' }];
        const next = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }];
        const result = reconcileById(prev, next);

        expect(result).toHaveLength(2);
        expect(result[0]).toBe(prev[0]);
        expect(result[1]).toBe(next[1]);
    });

    it('falls back to prev when next is not an array', () => {
        const prev = [{ id: 1 }];
        expect(reconcileById(prev, null)).toBe(prev);
    });
});
