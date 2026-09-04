import { describe, it, expect } from 'vitest';
import { isOwnerIssuedTokenCamera } from '../services/rentalPlaybackAccessPolicy.js';

/*
 * This predicate is the one rule that lets a share link reach NON-community footage — for playback
 * AND (since v1.4.2) for LIVE via the token grant. If it drifts, private cameras leak. These cases
 * lock the exact conditions the live gate in streamController now depends on.
 */
describe('isOwnerIssuedTokenCamera — owner-only gate for private footage (playback + live)', () => {
    const ownerPrivate = { id: 1443, camera_class: 'owner_private', owner_user_id: 5, billing_status: null };

    it('allows a token minted by the camera owner with a selected scope', () => {
        expect(isOwnerIssuedTokenCamera(ownerPrivate, { scope_type: 'selected', created_by: 5 })).toBe(true);
    });

    it('refuses a token minted by a DIFFERENT admin (not the owner)', () => {
        expect(isOwnerIssuedTokenCamera(ownerPrivate, { scope_type: 'selected', created_by: 6 })).toBe(false);
    });

    it('refuses a broad (all/area) token even from the owner — must not widen into private footage', () => {
        expect(isOwnerIssuedTokenCamera(ownerPrivate, { scope_type: 'all', created_by: 5 })).toBe(false);
        expect(isOwnerIssuedTokenCamera(ownerPrivate, { scope_type: 'area', created_by: 5 })).toBe(false);
    });

    it('refuses when the camera has no owner recorded', () => {
        expect(isOwnerIssuedTokenCamera({ ...ownerPrivate, owner_user_id: null }, { scope_type: 'selected', created_by: 5 })).toBe(false);
    });

    it('subscriber: owner-issued only counts while billing is active', () => {
        const active = { id: 2, camera_class: 'subscriber', owner_user_id: 7, billing_status: 'active' };
        const suspended = { ...active, billing_status: 'suspended' };
        expect(isOwnerIssuedTokenCamera(active, { scope_type: 'selected', created_by: 7 })).toBe(true);
        expect(isOwnerIssuedTokenCamera(suspended, { scope_type: 'selected', created_by: 7 })).toBe(false);
    });

    it('refuses a null/absent token', () => {
        expect(isOwnerIssuedTokenCamera(ownerPrivate, null)).toBe(false);
    });
});
