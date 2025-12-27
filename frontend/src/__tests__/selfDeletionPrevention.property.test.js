import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isSelfDeletion } from '../pages/UserManagement';

/**
 * Feature: admin-ux-improvement
 * Property Tests for Self-Deletion Prevention
 * 
 * Property 10: Self-Deletion Prevention
 * Validates: Requirements 6.5
 * 
 * WHEN admin attempts to delete their own account, THE User_Management SHALL 
 * prevent the action and display a warning
 */

describe('Self-Deletion Prevention', () => {
    /**
     * Feature: admin-ux-improvement
     * Property 10: Self-Deletion Prevention
     * Validates: Requirements 6.5
     * 
     * For any user ID and current user ID:
     * - isSelfDeletion returns true when IDs match
     * - isSelfDeletion returns false when IDs differ
     */
    it('Property 10: should return true when user ID matches current user ID', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000000 }),
                (userId) => {
                    // When userId equals currentUserId, it's self-deletion
                    const result = isSelfDeletion(userId, userId);
                    expect(result).toBe(true);
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('Property 10: should return false when user ID differs from current user ID', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000000 }),
                fc.integer({ min: 1, max: 1000000 }),
                (userId, currentUserId) => {
                    // Skip when IDs happen to be equal
                    fc.pre(userId !== currentUserId);
                    
                    const result = isSelfDeletion(userId, currentUserId);
                    expect(result).toBe(false);
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('Property 10: should handle edge case with ID 0', () => {
        // ID 0 matching itself
        expect(isSelfDeletion(0, 0)).toBe(true);
        // ID 0 vs non-zero
        expect(isSelfDeletion(0, 1)).toBe(false);
        expect(isSelfDeletion(1, 0)).toBe(false);
    });

    it('Property 10: should handle null/undefined current user gracefully', () => {
        // When currentUserId is null or undefined, should not match any userId
        expect(isSelfDeletion(1, null)).toBe(false);
        expect(isSelfDeletion(1, undefined)).toBe(false);
    });

    it('Property 10: should be symmetric - order of comparison matters', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000000 }),
                fc.integer({ min: 1, max: 1000000 }),
                (a, b) => {
                    // isSelfDeletion(userId, currentUserId) checks if userId === currentUserId
                    // The function should return true only when first arg equals second arg
                    const result1 = isSelfDeletion(a, b);
                    const result2 = isSelfDeletion(b, a);
                    
                    // Both should be true only when a === b
                    if (a === b) {
                        expect(result1).toBe(true);
                        expect(result2).toBe(true);
                    } else {
                        expect(result1).toBe(false);
                        expect(result2).toBe(false);
                    }
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('Property 10: should correctly identify self-deletion for any positive integer pair', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
                fc.boolean(),
                (baseId, shouldMatch) => {
                    const userId = baseId;
                    const currentUserId = shouldMatch ? baseId : baseId + 1;
                    
                    const result = isSelfDeletion(userId, currentUserId);
                    expect(result).toBe(shouldMatch);
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
