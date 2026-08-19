/**
 * Purpose: Validate that free-text log redaction removes URL credentials without eating context.
 * Caller: Vitest backend suite.
 * Deps: utils/logRedaction.
 * MainFuncs: redactUrlCredentials.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import { redactUrlCredentials } from '../utils/logRedaction.js';

describe('redactUrlCredentials', () => {
    it('masks user and password inside an FFmpeg error line', () => {
        const line = 'rtsp://admin:Aldivarama9@192.168.1.50:554/stream1: Connection timed out';
        const out = redactUrlCredentials(line);

        expect(out).not.toContain('Aldivarama9');
        expect(out).not.toContain('admin');
        expect(out).toBe('rtsp://****:****@192.168.1.50:554/stream1: Connection timed out');
    });

    it('masks a bare username with no password', () => {
        expect(redactUrlCredentials('rtsp://operator@10.0.0.9/live'))
            .toBe('rtsp://****:****@10.0.0.9/live');
    });

    it('masks every occurrence, not just the first', () => {
        const out = redactUrlCredentials(
            'failed rtsp://a:b@h1/s and rtsp://c:d@h2/s'
        );
        expect(out).not.toMatch(/[ab]:@|a:b|c:d/);
        expect(out).toBe('failed rtsp://****:****@h1/s and rtsp://****:****@h2/s');
    });

    it('covers http(s) sources too, not only rtsp', () => {
        expect(redactUrlCredentials('https://user:pw@cam.example/live.m3u8: 401'))
            .toBe('https://****:****@cam.example/live.m3u8: 401');
    });

    it('leaves credential-free URLs untouched', () => {
        const line = "[https @ 0x55] Opening 'https://data.example.go.id/live/x.m3u8?session=AbC' for reading";
        expect(redactUrlCredentials(line)).toBe(line);
    });

    /*
     * The "@" that matters is the one closing the authority. An "@" further down
     * the path is part of a filename and must not trigger a match — otherwise the
     * whole host+path collapses into "****:****@" and the line stops being useful.
     */
    it('does not match an @ that appears in a path', () => {
        const line = 'https://cdn.example/assets/logo@2x.png: 404';
        expect(redactUrlCredentials(line)).toBe(line);
    });

    it('passes through non-strings and empty values unchanged', () => {
        expect(redactUrlCredentials('')).toBe('');
        expect(redactUrlCredentials(null)).toBe(null);
        expect(redactUrlCredentials(undefined)).toBe(undefined);
        expect(redactUrlCredentials(42)).toBe(42);
    });
});

/*
 * REGRESSION (produksi, 2026-08-20): userinfo bukan lagi cara pihak ketiga membagi akses — token
 * bearer di URL yang dipakai sekarang, dan FFmpeg menggemakan seluruh baris perintahnya saat gagal.
 * Produksi menulis JWT ZoneMinder UTUH ke log pm2 (yang diarsipkan) tiap kali kamera Jombang gagal
 * menghasilkan thumbnail. Token itu kedaluwarsa 2 jam — itu membatasi kerusakannya, bukan membuatnya
 * aman diterbitkan.
 */
describe('rahasia di query string', () => {
    it('menyamarkan token tapi membiarkan sisa barisnya utuh', () => {
        const line = 'https://cctv.jombangkab.go.id/zm/cgi-bin/nph-zms?monitor=168&token=eyJhbGciOiJIUzI1NiJ9.abc.def -vframes 1 -q:v 8';

        expect(redactUrlCredentials(line)).toBe(
            'https://cctv.jombangkab.go.id/zm/cgi-bin/nph-zms?monitor=168&token=**** -vframes 1 -q:v 8'
        );
    });

    it('menyamarkan nama-nama rahasia yang lain, dan hanya nilainya', () => {
        expect(redactUrlCredentials('https://x/y?password=s3cr3t&next=ok')).toBe('https://x/y?password=****&next=ok');
        expect(redactUrlCredentials('https://x/y?api_key=AKIA123&z=1')).toBe('https://x/y?api_key=****&z=1');
        expect(redactUrlCredentials('https://x/y?SIGNATURE=abc')).toBe('https://x/y?SIGNATURE=****');
    });

    /*
     * Nama parameter yang tidak berbahaya HARUS lolos — itulah bagian yang membuat kegagalan bisa
     * didiagnosis, dan menyamarkan berlebihan cuma menukar satu masalah operasional dengan yang lain.
     */
    it('tidak menyentuh parameter biasa', () => {
        expect(redactUrlCredentials('https://x/y?monitor=122&scale=320')).toBe('https://x/y?monitor=122&scale=320');
        expect(redactUrlCredentials('https://x/photos/me@2x.png?monitor=1')).toBe('https://x/photos/me@2x.png?monitor=1');
    });

    it('kedua aturan berlaku pada baris yang sama', () => {
        expect(redactUrlCredentials('rtsp://admin:hunter2@10.0.0.4:554/s?token=abc: timed out'))
            .toBe('rtsp://****:****@10.0.0.4:554/s?token=****: timed out');
    });
});
