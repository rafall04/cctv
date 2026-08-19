/**
 * Purpose: Lock the imperative queue between API and recorder worker — an explicit stop/restart
 *          must survive coalescing and must not be downgraded into a desired-state reconcile.
 * Caller: Backend Vitest suite.
 * Deps: better-sqlite3 in-memory DB injected through the connection-pool mock.
 * SideEffects: None outside the in-memory database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

let db;

vi.mock('../database/connectionPool.js', () => ({
    execute: (sql, params = []) => db.prepare(sql).run(...params),
    query: (sql, params = []) => db.prepare(sql).all(...params),
    queryOne: (sql, params = []) => db.prepare(sql).get(...params) ?? null,
}));

const { requestReconcile, takeReconcileRequests, RECONCILE_ACTIONS } =
    await import('../services/recordingWorkerStateRepository.js');

beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
        CREATE TABLE recording_reconcile_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            requested_at TEXT NOT NULL,
            action TEXT NOT NULL DEFAULT 'reconcile'
        )
    `);
});

describe('antrean permintaan membawa NIAT, bukan cuma "reconcile"', () => {
    it('menyimpan dan mengembalikan action apa adanya', () => {
        requestReconcile(7, 'admin_stop', 'stop');

        expect(takeReconcileRequests()).toEqual([
            { cameraId: 7, reason: 'admin_stop', action: 'stop' },
        ]);
    });

    it('default tetap reconcile bila tidak disebut', () => {
        requestReconcile(7, 'health_transition_offline');

        expect(takeReconcileRequests()[0].action).toBe('reconcile');
    });

    it('menolak action karangan dan jatuh ke reconcile, bukan menulisnya mentah', () => {
        requestReconcile(7, 'aneh', 'hapus-semuanya');

        expect(takeReconcileRequests()[0].action).toBe('reconcile');
        expect(RECONCILE_ACTIONS).toEqual(['reconcile', 'start', 'restart', 'stop']);
    });

    /*
     * Inti perbaikannya. Reconcile adalah keputusan DESIRED-STATE: kamera yang enabled, recordable,
     * online dan sudah merekam menghasilkan `noop_recording`. Kalau sebuah reconcile rutin datang
     * SESUDAH perintah restart lalu memenangkan coalescing, perintah itu hilang tanpa jejak — dan
     * itulah yang membuat ganti URL RTSP tak pernah me-restart perekam.
     */
    it('perintah imperatif tidak boleh ditelan reconcile yang datang belakangan', () => {
        requestReconcile(7, 'camera_source_updated', 'restart');
        requestReconcile(7, 'health_transition_online');

        const [claimed] = takeReconcileRequests();
        expect(claimed.action).toBe('restart');
        expect(claimed.reason).toBe('camera_source_updated');
    });

    it('reconcile yang datang lebih dulu pun kalah dari imperatif sesudahnya', () => {
        requestReconcile(7, 'periodic');
        requestReconcile(7, 'admin_stop', 'stop');

        expect(takeReconcileRequests()[0].action).toBe('stop');
    });

    it('di antara sesama imperatif, yang TERAKHIR menang — itu niat terkini operator', () => {
        requestReconcile(7, 'admin_stop', 'stop');
        requestReconcile(7, 'admin_start', 'start');

        expect(takeReconcileRequests()[0].action).toBe('start');
    });

    it('kamera berbeda tidak saling mencampuri', () => {
        requestReconcile(7, 'admin_stop', 'stop');
        requestReconcile(8, 'periodic');

        const claimed = takeReconcileRequests().sort((a, b) => a.cameraId - b.cameraId);
        expect(claimed.map((c) => [c.cameraId, c.action])).toEqual([[7, 'stop'], [8, 'reconcile']]);
    });

    it('mengosongkan antrean setelah diklaim — ini antrean kerja, bukan log', () => {
        requestReconcile(7, 'admin_stop', 'stop');
        takeReconcileRequests();

        expect(takeReconcileRequests()).toEqual([]);
    });

    /*
     * Baris yang ditulis proses versi LAMA tidak menyebut action sama sekali. Migrasinya memberi
     * kolom itu DEFAULT 'reconcile', jadi baris seperti itu harus terbaca persis seperti dulu —
     * bukan undefined yang diam-diam lolos ke worker.
     */
    it('baris tanpa action terbaca sebagai reconcile lewat DEFAULT kolomnya', () => {
        db.prepare("INSERT INTO recording_reconcile_requests (camera_id, reason, requested_at) VALUES (7,'lama','x')").run();

        expect(takeReconcileRequests()[0].action).toBe('reconcile');
    });
});
