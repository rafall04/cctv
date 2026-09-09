import { describe, it, expect } from 'vitest';
import { normalizeForSpeech } from '../services/audioTtsService.js';

describe('audioTtsService.normalizeForSpeech', () => {
    it('reads "/" as "atau", not "garis miring"', () => {
        expect(normalizeForSpeech('Bapak/Ibu')).toBe('Bapak atau Ibu');
        expect(normalizeForSpeech('RT/RW')).toBe('RT atau RW');
    });

    it('reads "&" as "dan"', () => {
        expect(normalizeForSpeech('RT & RW')).toBe('RT dan RW');
    });

    it('drops any unfilled {placeholder} so it is never spoken', () => {
        expect(normalizeForSpeech('Bapak/Ibu {nama}, hadir').replace(/\s+/g, ' ').trim())
            .toBe('Bapak atau Ibu , hadir');
        expect(normalizeForSpeech('{a}{b}c').includes('{')).toBe(false);
    });

    it('leaves ordinary text untouched', () => {
        expect(normalizeForSpeech('Kerja bakti pukul tujuh pagi')).toBe('Kerja bakti pukul tujuh pagi');
    });
});
