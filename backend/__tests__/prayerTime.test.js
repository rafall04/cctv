import { describe, it, expect } from 'vitest';
import { computePrayerTimes } from '../services/prayerTimeService.js';

const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

describe('prayerTimeService.computePrayerTimes', () => {
    it('produces prayer times in the correct order', () => {
        const t = computePrayerTimes({ year: 2026, month: 9, day: 9 }, { lat: -7.5, lon: 111.88, tz: 7 });
        const order = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
        for (let i = 1; i < order.length; i += 1) {
            expect(toMin(t[order[i]])).toBeGreaterThan(toMin(t[order[i - 1]]));
        }
    });

    it('matches known Jakarta times (Kemenag angles) within ~2 minutes', () => {
        // Reference (published Kemenag-style schedule, Jakarta 2026-01-01):
        // Subuh ~04:19, Dzuhur ~11:58, Ashar ~15:24, Maghrib ~18:11, Isya ~19:26.
        const t = computePrayerTimes({ year: 2026, month: 1, day: 1 }, { lat: -6.2, lon: 106.85, tz: 7 });
        const near = (got, want) => expect(Math.abs(toMin(got) - want)).toBeLessThanOrEqual(2);
        near(t.fajr, toMin('04:19'));
        near(t.dhuhr, toMin('11:58'));
        near(t.asr, toMin('15:24'));
        near(t.maghrib, toMin('18:11'));
        near(t.isha, toMin('19:26'));
    });

    it('per-prayer offset shifts the time', () => {
        const base = computePrayerTimes({ year: 2026, month: 6, day: 21 }, { lat: -7.5, lon: 111.88, tz: 7 });
        const shifted = computePrayerTimes({ year: 2026, month: 6, day: 21 }, { lat: -7.5, lon: 111.88, tz: 7, offsets: { dhuhr: 5 } });
        expect(toMin(shifted.dhuhr) - toMin(base.dhuhr)).toBe(5);
    });
});
