/*
 * Purpose: Reconcile a freshly-fetched array of id-keyed records against the previous array, preserving
 *          object identity for unchanged items — and the whole previous array when nothing changed — so
 *          React can skip re-rendering memoized consumers on no-op or partial background refreshes.
 * Caller: CameraContext background/resume refresh (cameras + areas).
 * Deps: None (pure).
 * MainFuncs: shallowEqualRecord, reconcileById.
 * SideEffects: None.
 *
 * Correctness note: this is a pure optimization. Whenever anything is uncertain (nested object whose
 * reference changed, different key set, reordering) the item/array is treated as CHANGED and the fresh
 * value is used — it never keeps a stale record. Worst case it behaves exactly like a plain replace.
 */

/**
 * Shallow equality over own enumerable keys using Object.is per value.
 * Nested objects compared by reference (a new nested object ref counts as changed).
 * @returns {boolean}
 */
export function shallowEqualRecord(a, b) {
    if (a === b) {
        return true;
    }
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
        return false;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
        return false;
    }

    for (let i = 0; i < aKeys.length; i += 1) {
        const key = aKeys[i];
        if (!Object.prototype.hasOwnProperty.call(b, key) || !Object.is(a[key], b[key])) {
            return false;
        }
    }
    return true;
}

/**
 * Reconcile `next` against `prev`, reusing prev item identities for shallow-equal records.
 * Returns `prev` (same array reference) when the lists are equivalent in content and order — letting a
 * useState setter bail out of a re-render entirely.
 *
 * @param {Array<Object>} prev Previously applied list.
 * @param {Array<Object>} next Freshly fetched list.
 * @param {string} [idKey='id'] Identity key.
 * @returns {Array<Object>} Reconciled list (possibly the same reference as `prev`).
 */
export function reconcileById(prev, next, idKey = 'id') {
    if (!Array.isArray(next)) {
        return Array.isArray(prev) ? prev : next;
    }
    if (!Array.isArray(prev) || prev.length === 0) {
        return next;
    }

    const prevById = new Map();
    for (let i = 0; i < prev.length; i += 1) {
        const item = prev[i];
        if (item && item[idKey] != null) {
            prevById.set(item[idKey], item);
        }
    }

    const merged = next.map((item) => {
        const id = item && item[idKey] != null ? item[idKey] : undefined;
        const previous = id === undefined ? undefined : prevById.get(id);
        return previous && shallowEqualRecord(previous, item) ? previous : item;
    });

    if (merged.length !== prev.length) {
        return merged;
    }
    for (let i = 0; i < merged.length; i += 1) {
        if (merged[i] !== prev[i]) {
            return merged;
        }
    }
    // Same length, same order, every item identity-preserved → nothing changed.
    return prev;
}

export default reconcileById;
