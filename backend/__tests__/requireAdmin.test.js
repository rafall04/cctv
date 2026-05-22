/**
 * Purpose: Verify the requireAdmin role guard rejects non-admin users.
 * Caller: Vitest backend suite.
 * Deps: middleware/authMiddleware.js requireAdmin.
 * MainFuncs: requireAdmin.
 * SideEffects: None.
 */
import { describe, expect, it, vi } from 'vitest';
import { requireAdmin } from '../middleware/authMiddleware.js';

function makeReply() {
    const reply = {
        statusCode: null,
        payload: null,
        code(status) {
            this.statusCode = status;
            return this;
        },
        send(payload) {
            this.payload = payload;
            return this;
        },
    };
    return reply;
}

describe('requireAdmin role guard', () => {
    it('allows an admin user through (no reply sent)', async () => {
        const reply = makeReply();
        const sendSpy = vi.spyOn(reply, 'send');
        await requireAdmin({ user: { id: 1, role: 'admin' } }, reply);
        expect(sendSpy).not.toHaveBeenCalled();
    });

    it('rejects a viewer with 403', async () => {
        const reply = makeReply();
        await requireAdmin({ user: { id: 2, role: 'viewer' } }, reply);
        expect(reply.statusCode).toBe(403);
        expect(reply.payload.success).toBe(false);
    });

    it('rejects a request with no authenticated user with 403', async () => {
        const reply = makeReply();
        await requireAdmin({}, reply);
        expect(reply.statusCode).toBe(403);
    });
});
