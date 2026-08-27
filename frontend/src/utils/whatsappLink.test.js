/*
Purpose: Unit tests for buildWhatsappLink / applyWhatsappTemplate — placeholder substitution, default fallback, missing-number guard.
Caller: Vitest frontend suite.
Deps: vitest, whatsappLink utility.
MainFuncs: whatsappLink behavior tests.
SideEffects: None.
*/

import { describe, expect, it } from 'vitest';
import {
    applyWhatsappTemplate,
    buildWhatsappLink,
    DEFAULT_WHATSAPP_TEMPLATE,
} from './whatsappLink.js';

describe('whatsappLink — applyWhatsappTemplate', () => {
    it('substitutes known placeholders from context', () => {
        const out = applyWhatsappTemplate(
            'Halo Admin {{company_name}}, soal {{page}} di {{city_name}}',
            { company_name: 'RAF NET', page: 'playback', city_name: 'Bojonegoro' }
        );
        expect(out).toBe('Halo Admin RAF NET, soal playback di Bojonegoro');
    });

    it('replaces unknown placeholders with empty string instead of leaking the literal', () => {
        const out = applyWhatsappTemplate('hello {{unknown}} world', {});
        // Note the two spaces — the placeholder vanishes, surrounding text stays.
        expect(out).toBe('hello  world');
    });

    it('falls back to the default template when input is empty or whitespace', () => {
        expect(applyWhatsappTemplate('', { company_name: 'X', page: 'Beranda' }))
            .toBe('Halo Admin X, saya ingin tanya soal Beranda.');
        expect(applyWhatsappTemplate('   ', { company_name: 'X', page: 'Beranda' }))
            .toBe('Halo Admin X, saya ingin tanya soal Beranda.');
        expect(applyWhatsappTemplate(null, { company_name: 'X', page: 'Beranda' }))
            .toBe('Halo Admin X, saya ingin tanya soal Beranda.');
    });

    it('tolerates whitespace inside braces ({{ key }})', () => {
        expect(applyWhatsappTemplate('hi {{ company_name }}', { company_name: 'RAF NET' }))
            .toBe('hi RAF NET');
    });

    it('renders missing camera_name as empty (not the placeholder literal)', () => {
        const out = applyWhatsappTemplate(
            'Lihat kamera {{camera_name}} di {{page}}',
            { page: 'Playback' }
        );
        expect(out).toBe('Lihat kamera  di Playback');
    });
});

describe('whatsappLink — buildWhatsappLink', () => {
    it('builds a wa.me URL with the substituted message', () => {
        const url = buildWhatsappLink(
            {
                whatsapp_number: '628123',
                company_name: 'RAF NET',
                whatsapp_message_template: 'Halo {{company_name}}, soal {{page}}',
            },
            { page: 'Beranda' }
        );
        expect(url).toBe(`https://wa.me/628123?text=${encodeURIComponent('Halo RAF NET, soal Beranda')}`);
    });

    it('uses the default template when whatsapp_message_template is missing', () => {
        const url = buildWhatsappLink(
            { whatsapp_number: '628123', company_name: 'RAF NET' },
            { page: 'Playback CCTV' }
        );
        expect(url).toBe(
            `https://wa.me/628123?text=${encodeURIComponent('Halo Admin RAF NET, saya ingin tanya soal Playback CCTV.')}`
        );
    });

    it('returns empty string when no whatsapp_number is configured', () => {
        expect(buildWhatsappLink({ whatsapp_number: '' }, { page: 'x' })).toBe('');
        expect(buildWhatsappLink({}, { page: 'x' })).toBe('');
        expect(buildWhatsappLink(null, { page: 'x' })).toBe('');
    });

    it('trims whitespace from the whatsapp_number before composing the link', () => {
        const url = buildWhatsappLink({ whatsapp_number: '  628123  ' }, { page: 'X' });
        expect(url).toContain('https://wa.me/628123?');
    });

    it('exposes the canonical default template constant', () => {
        expect(DEFAULT_WHATSAPP_TEMPLATE).toContain('{{company_name}}');
        expect(DEFAULT_WHATSAPP_TEMPLATE).toContain('{{page}}');
    });
});

/*
 * NOMOR DINORMALKAN — ditambahkan 2026-08-27.
 *
 * Helper ini dulu memakai nomor MENTAH. Operator mengetik `0812…` (bentuk yang tercetak di setiap
 * etalase di negeri ini) dan wa.me diam-diam gagal padanya: tautannya terbentuk, terlihat benar,
 * lalu membuka WhatsApp pada nomor yang tidak ada. Bagi pengunjung itu terbaca "WhatsApp-nya
 * rusak", bukan "setelannya salah" — dan tidak ada satu pun galat yang muncul di mana pun.
 *
 * Belum menggigit hanya karena produksi memang belum punya nomor sama sekali. Ia akan menggigit
 * pada hari nomornya diisi, yaitu hari halaman /dukungan mulai dipakai mencari sponsor.
 */
describe('bentuk nomor wa.me', () => {
    const tautan = (nomor) => buildWhatsappLink({ whatsapp_number: nomor, company_name: 'RAF' });

    it('mengubah bentuk lokal 0812… menjadi 62812…', () => {
        expect(tautan('081234567890')).toContain('https://wa.me/6281234567890?');
    });

    it('menerima +62 dengan spasi dan tanda hubung', () => {
        expect(tautan('+62 812-3456-7890')).toContain('wa.me/6281234567890?');
    });

    it('tidak menggandakan kode negara yang sudah ada', () => {
        expect(tautan('6281234567890')).toContain('wa.me/6281234567890?');
        expect(tautan('6281234567890')).not.toContain('wa.me/626281');
    });

    it('nomor yang hanya berisi tanda baca dianggap tidak ada', () => {
        // Kalau ini mengembalikan tautan, pemanggil yang bercabang di truthiness akan merender
        // tombol menuju wa.me tanpa nomor.
        expect(tautan('--- ---')).toBe('');
        expect(tautan('   ')).toBe('');
    });

    it('tetap mengembalikan string kosong tanpa nomor - kontrak lama tidak berubah', () => {
        expect(buildWhatsappLink({ company_name: 'RAF' })).toBe('');
        expect(buildWhatsappLink(null)).toBe('');
    });
});
