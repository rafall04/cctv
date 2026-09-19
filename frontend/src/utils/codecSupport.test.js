/*
 * Purpose: Lock the codec gate that decides whether a stream can be played at all.
 * Caller: frontend test gate.
 *
 * Why this matters more than it looks: hls.js will happily download fragments it cannot decode
 * forever, so nothing downstream ever concludes anything. Measured on production with HEVC
 * disabled — 70 seconds, zero bytes buffered, no error, overlay stuck on "Memuat stream". This
 * gate is what turns that into an immediate, correct "Codec Tidak Didukung".
 *
 * The asymmetry asserted throughout: a definite NO blocks playback, but "unknown" NEVER does.
 * Refusing to play on a maybe would break devices that are perfectly capable.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { isCodecStringPlayable, isHevcPlayable, isGuaranteedUnplayableHevc, getCodecWarning } from './codecSupport';

const H265 = 'hvc1.1.6.L150.0';
const H264 = 'avc1.640028';

/** Replace MediaSource.isTypeSupported with a predicate over the codec string. */
function fakeDecoder(canPlay) {
    vi.stubGlobal('MediaSource', { isTypeSupported: (t) => canPlay(String(t)) });
    vi.stubGlobal('ManagedMediaSource', undefined);
}
const noHevc = () => fakeDecoder((t) => !/hvc1|hev1/i.test(t));
const allCodecs = () => fakeDecoder(() => true);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('isCodecStringPlayable bertanya ke media stack', () => {
    it('menjawab benar/salah sesuai jawaban decoder', () => {
        noHevc();
        expect(isCodecStringPlayable(`video/mp4;codecs="${H264}"`)).toBe(true);
        expect(isCodecStringPlayable(`video/mp4;codecs="${H265}"`)).toBe(false);
    });

    it('mengembalikan null kalau pertanyaannya tidak bisa diajukan', () => {
        // null berarti "lewati", bukan "anggap tidak bisa" — lihat asimetri di header berkas.
        vi.stubGlobal('MediaSource', undefined);
        vi.stubGlobal('ManagedMediaSource', undefined);
        expect(isCodecStringPlayable(`video/mp4;codecs="${H265}"`)).toBeNull();
    });

    it('isTypeSupported yang melempar tidak merembet keluar', () => {
        vi.stubGlobal('MediaSource', { isTypeSupported: () => { throw new Error('boom'); } });
        vi.stubGlobal('ManagedMediaSource', undefined);
        expect(isCodecStringPlayable(`video/mp4;codecs="${H265}"`)).toBeNull();
    });
});

describe('isHevcPlayable', () => {
    it('true kalau salah satu fourcc diterima', () => {
        // hvc1 dan hev1 adalah codec yang sama; sebagian build hanya menerima salah satunya.
        fakeDecoder((t) => /hev1/i.test(t));
        expect(isHevcPlayable()).toBe(true);
    });

    it('false kalau keduanya ditolak', () => {
        noHevc();
        expect(isHevcPlayable()).toBe(false);
    });
});

describe('isGuaranteedUnplayableHevc — veto pra-fetch', () => {
    it('veto hanya saat h265 internal + MSE menolak + jalur native bungkam', () => {
        // Bentuk Chrome/Android pada umumnya: MSE menjawab "tidak", canPlayType mengembalikan ''.
        noHevc();
        expect(isGuaranteedUnplayableHevc({ videoCodec: 'h265' })).toBe(true);
    });

    it('tidak pernah veto h264', () => {
        noHevc();
        expect(isGuaranteedUnplayableHevc({ videoCodec: 'h264' })).toBe(false);
    });

    it('tidak veto saat decoder memang mampu', () => {
        allCodecs();
        expect(isGuaranteedUnplayableHevc({ videoCodec: 'h265' })).toBe(false);
    });

    it('tidak veto saat dukungan tidak bisa dibuktikan (tanpa MSE)', () => {
        // Asimetri yang sama dengan isHevcPlayable: "tidak tahu" bukan "tidak bisa".
        vi.stubGlobal('MediaSource', undefined);
        vi.stubGlobal('ManagedMediaSource', undefined);
        expect(isGuaranteedUnplayableHevc({ videoCodec: 'h265' })).toBe(false);
    });

    it('jalur native yang menjawab ya adalah escape hatch (Safari)', () => {
        // Safari membisukan MSE untuk hvc1 tetapi memutar HEVC lewat jalur native —
        // jawaban canPlayType non-kosong berarti stream ini mungkin masih bisa jalan.
        noHevc();
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
        expect(isGuaranteedUnplayableHevc({ videoCodec: 'h265' })).toBe(false);
    });

    it('stream eksternal tidak pernah diveto — provider bisa saja mentranskode', () => {
        noHevc();
        expect(isGuaranteedUnplayableHevc({ videoCodec: 'h265', isExternal: true })).toBe(false);
    });
});

describe('peringatan codec berhenti menebak dari User-Agent', () => {
    it('perangkat yang TERBUKTI mendukung H.265 tidak diberi peringatan apa pun', () => {
        // Versi lama menjawab "partial" untuk setiap Chrome di dunia, jadi kartu landing hanya
        // bisa berkata "tergantung hardware device" — angkat bahu atas pertanyaan yang sebenarnya
        // dijawab pasti oleh browser.
        allCodecs();
        expect(getCodecWarning('h265')).toBeNull();
    });

    it('perangkat yang TERBUKTI tidak mendukung diberi peringatan tegas, bukan "mungkin"', () => {
        noHevc();
        const w = getCodecWarning('h265');
        expect(w.severity).toBe('error');
        expect(w.shortMessage).toBe('Tidak didukung');
    });

    it('h264 tidak pernah diperingatkan', () => {
        noHevc();
        expect(getCodecWarning('h264')).toBeNull();
    });
});
