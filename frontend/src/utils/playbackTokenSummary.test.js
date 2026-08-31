import { describe, expect, it } from 'vitest';
import { describeTokenLimits } from './playbackTokenSummary.js';

describe('playbackTokenSummary.describeTokenLimits', () => {
    it('rolling window + expiry + all scope', () => {
        const s = describeTokenLimits({ windowHours: 720, expiresAt: '2026-09-10T00:00:00Z', scopeType: 'all' });
        expect(s).toContain('1 bulan terakhir');
        expect(s).toContain('berlaku sampai');
        expect(s).toContain('semua kamera playback');
    });

    it('absolute date range wins over window', () => {
        const s = describeTokenLimits({
            windowHours: 720, playbackFrom: '2026-08-01T00:00:00Z', playbackTo: '2026-08-05T00:00:00Z',
        });
        expect(s).toContain('–'); // a date range, not "N terakhir"
        expect(s).not.toContain('terakhir');
    });

    it('no window and no range → all recordings; no expiry → selamanya', () => {
        const s = describeTokenLimits({ windowHours: null, expiresAt: null });
        expect(s).toContain('semua rekaman yang tersedia');
        expect(s).toContain('berlaku selamanya');
    });

    it('selected scope names the camera count', () => {
        const s = describeTokenLimits({ windowHours: 24, scopeType: 'selected', cameraCount: 3 });
        expect(s).toContain('3 kamera terpilih');
    });

    it('open-ended absolute range reads naturally', () => {
        expect(describeTokenLimits({ playbackFrom: '2026-08-01T00:00:00Z' })).toContain('sejak');
        expect(describeTokenLimits({ playbackTo: '2026-08-05T00:00:00Z' })).toContain('sampai');
    });
});
