/**
 * Purpose: Verify the counting runner starts/stops units safely and never restarts a healthy one.
 * Caller: Backend test gate.
 * Deps: vitest, mocked child_process.
 * MainFuncs: nyalakan / matikan behaviour tests.
 * SideEffects: none; execFile is mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock('child_process', () => ({
    execFile: (cmd, args, opts, cb) => {
        const done = typeof opts === 'function' ? opts : cb;
        try {
            execFileMock(cmd, args);
            done(null, { stdout: '', stderr: '' });
        } catch (e) {
            done(e);
        }
    },
}));

async function muat() {
    return import('../services/vehicleCountRunnerService.js');
}

describe('vehicleCountRunnerService', () => {
    beforeEach(() => {
        vi.resetModules();
        execFileMock.mockReset();
        process.env.VEHICLE_COUNT_UNIT = 'yolo-counter@%i.service';
    });

    /*
     * `restart` juga membunuh proses yang SEHAT, jadi tiap kali admin menyimpan setelan,
     * stream beranotasi akan mati beberapa detik dan penonton melihat kotaknya lenyap.
     * `start` bersifat idempoten: yang sudah jalan dibiarkan, perubahan setelan diambil
     * sendiri oleh penghitung yang memantau berkas config.
     */
    it('memakai start, bukan restart — menyimpan setelan tidak boleh memutus tayangan', async () => {
        const { nyalakan } = await muat();
        await nyalakan(15);

        expect(execFileMock).toHaveBeenCalledWith('systemctl', ['start', 'yolo-counter@15.service']);
        expect(execFileMock.mock.calls[0][1]).not.toContain('restart');
    });

    it('mematikan unit kamera yang benar', async () => {
        const { matikan } = await muat();
        await matikan(15);
        expect(execFileMock).toHaveBeenCalledWith('systemctl', ['stop', 'yolo-counter@15.service']);
    });

    /*
     * Nilai yang sampai ke systemctl hanya boleh bilangan bulat positif. Ini yang menjaga
     * sebuah form admin tidak berubah menjadi eksekusi perintah.
     */
    it('menolak id yang bukan bilangan bulat positif', async () => {
        const { nyalakan } = await muat();
        for (const jahat of ['15; rm -rf /', '../../etc', -1, 0, 1.5, null, undefined, 'abc']) {
            expect(await nyalakan(jahat)).toBe(false);
        }
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it('tidak melakukan apa-apa bila unit tidak dikonfigurasi', async () => {
        process.env.VEHICLE_COUNT_UNIT = '';
        const { nyalakan, matikan } = await muat();
        expect(await nyalakan(15)).toBe(false);
        expect(await matikan(15)).toBe(false);
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it('melaporkan gagal tanpa melempar — kegagalan menjalankan tidak boleh menggagalkan penyimpanan', async () => {
        execFileMock.mockImplementation(() => { throw new Error('unit not found'); });
        const { nyalakan } = await muat();
        expect(await nyalakan(15)).toBe(false);
    });
});
