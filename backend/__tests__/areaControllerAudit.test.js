/*
 * Purpose: Prove area create/update/delete leave a trace, including what the area WAS.
 * Caller: Backend Vitest suite.
 * Deps: mocked areaService + securityAuditLogger, real areaController.
 * MainFuncs: area audit tests.
 * SideEffects: None.
 *
 * Areas decide which cameras appear on the public grid (show_on_grid_default) and how wide their
 * coverage claim is. Production carried 15 BULK_UPDATE_AREA rows and not a single CREATE/UPDATE/
 * DELETE_AREA — so an area could be renamed, hidden from the public, or deleted outright with no
 * record of who did it or what it held.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAreaMock = vi.fn();
const updateAreaMock = vi.fn();
const deleteAreaMock = vi.fn();
const getAreaByIdMock = vi.fn();
const logAdminActionMock = vi.fn();

vi.mock('../services/areaService.js', () => ({
    default: {
        createArea: createAreaMock,
        updateArea: updateAreaMock,
        deleteArea: deleteAreaMock,
        getAreaById: getAreaByIdMock,
    },
}));
vi.mock('../services/securityAuditLogger.js', () => ({ logAdminAction: logAdminActionMock }));

const { createArea, updateArea, deleteArea } = await import('../controllers/areaController.js');

function makeReply() {
    return {
        statusCode: 200,
        body: null,
        code(status) { this.statusCode = status; return this; },
        send(payload) { this.body = payload; return this; },
    };
}

const req = (overrides = {}) => ({ params: {}, body: {}, user: { id: 3 }, ...overrides });

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('area audit trail', () => {
    it('records who created which area', async () => {
        createAreaMock.mockReturnValue({ id: 12, name: 'Dander', kecamatan: 'Bojonegoro' });

        const reply = makeReply();
        await createArea(req({ body: { name: 'Dander' } }), reply);

        expect(reply.statusCode).toBe(201);
        const [entry] = logAdminActionMock.mock.calls[0];
        expect(entry).toMatchObject({ action: 'CREATE_AREA', targetId: 12, userId: 3 });
        expect(entry.details.name).toBe('Dander');
    });

    it('records the public-facing fields BEFORE and after an update', async () => {
        getAreaByIdMock.mockReturnValue({ name: 'Lama', show_on_grid_default: 1, coverage_scope: 'kecamatan' });
        updateAreaMock.mockReturnValue({ name: 'Baru', show_on_grid_default: 0, coverage_scope: 'desa' });

        await updateArea(req({ params: { id: '12' }, body: { name: 'Baru' } }), makeReply());

        const [entry] = logAdminActionMock.mock.calls[0];
        expect(entry.action).toBe('UPDATE_AREA');
        // Hiding an area from the public grid is the change most worth being able to reconstruct.
        expect(entry.details.from).toMatchObject({ name: 'Lama', show_on_grid_default: 1 });
        expect(entry.details.to).toMatchObject({ name: 'Baru', show_on_grid_default: 0 });
    });

    it('reads the previous state BEFORE the write', async () => {
        const order = [];
        getAreaByIdMock.mockImplementation(() => { order.push('read'); return { name: 'Lama' }; });
        updateAreaMock.mockImplementation(() => { order.push('write'); return { name: 'Baru' }; });

        await updateArea(req({ params: { id: '12' } }), makeReply());

        expect(order).toEqual(['read', 'write']);
    });

    it('captures the area identity BEFORE deleting it', async () => {
        const order = [];
        getAreaByIdMock.mockImplementation(() => { order.push('read'); return { name: 'Dander', kecamatan: 'Bojonegoro' }; });
        deleteAreaMock.mockImplementation(() => { order.push('delete'); });

        await deleteArea(req({ params: { id: '12' } }), makeReply());

        expect(order).toEqual(['read', 'delete']);
        const [entry] = logAdminActionMock.mock.calls[0];
        expect(entry.action).toBe('DELETE_AREA');
        // Without this the log could only say "area 12 was deleted", which reconstructs nothing.
        expect(entry.details).toMatchObject({ name: 'Dander', kecamatan: 'Bojonegoro' });
    });

    it('writes no audit entry when the operation itself fails', async () => {
        const err = new Error('Area sudah ada');
        err.statusCode = 400;
        createAreaMock.mockImplementation(() => { throw err; });

        const reply = makeReply();
        await createArea(req({ body: {} }), reply);

        expect(reply.statusCode).toBe(400);
        expect(logAdminActionMock).not.toHaveBeenCalled();
    });
});
