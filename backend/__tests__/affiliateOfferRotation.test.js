/**
 * Purpose: Kunci bahwa tawaran yang SERI berputar per hari, dan bahwa yang tidak seri tidak.
 * Caller: Backend test gate (vitest, node env).
 * Deps: better-sqlite3 in-memory dengan skema sungguhan; timeService dipatok dan bisa digeser.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Pemutus ikatan dulunya `o.id DESC`. Artinya, ketika dua tawaran mengincar kamera yang sama
 * dengan prioritas yang sama, yang lebih TUA padam SELAMANYA - nol impresi, seumur hidup - padahal
 * mitranya tetap ditagih. Tidak ada galat, tidak ada peringatan; hanya satu mitra yang perlahan
 * menyimpulkan bahwa permukaan ini tidak menghasilkan apa-apa dan berhenti memperpanjang.
 *
 * Nol konteks seperti itu ada di produksi hari ini - keempat tawaran mengincar kamera yang
 * berbeda-beda. Justru karena itu sekarang ongkosnya nol.
 *
 * Berkas TERPISAH dari affiliateOfferService.test.js karena di sana getLocalDate() dipatok ke satu
 * tanggal mati, dan seluruh isi berkas ini adalah tentang tanggal yang BERGERAK.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => {
    const Db = require('better-sqlite3');
    return { db: new Db(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
    transaction: (fn) => db.transaction(fn),
}));

/* Tanggal yang bisa digeser. Objek pembungkus karena vi.mock diangkat ke atas semua const. */
const { jam } = vi.hoisted(() => ({ jam: { hariIni: '2026-08-12' } }));
vi.mock('../services/timeService.js', () => ({ getLocalDate: () => jam.hariIni }));

const { resolveOfferForContext } = await import('../services/affiliateOfferService.js');

function resetSchema() {
    db.exec(`
        DROP TABLE IF EXISTS affiliate_offer_targets;
        DROP TABLE IF EXISTS affiliate_offers;
        DROP TABLE IF EXISTS affiliate_partners;
        DROP TABLE IF EXISTS cameras;
        DROP TABLE IF EXISTS areas;

        CREATE TABLE areas (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY, name TEXT, area_id INTEGER,
            camera_class TEXT NOT NULL DEFAULT 'community'
        );
        CREATE TABLE affiliate_partners (
            id INTEGER PRIMARY KEY AUTOINCREMENT, store_name TEXT NOT NULL, store_url TEXT,
            contact_note TEXT, billing_mode TEXT NOT NULL DEFAULT 'term',
            price_rupiah INTEGER NOT NULL DEFAULT 0, start_date TEXT, end_date TEXT,
            active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE affiliate_offers (
            id INTEGER PRIMARY KEY AUTOINCREMENT, partner_id INTEGER NOT NULL,
            product_title TEXT NOT NULL, description TEXT, product_url TEXT NOT NULL,
            target_mode TEXT NOT NULL DEFAULT 'all', placements TEXT NOT NULL DEFAULT '["popup"]',
            priority INTEGER NOT NULL DEFAULT 100, active INTEGER NOT NULL DEFAULT 1,
            whatsapp_number TEXT, whatsapp_message TEXT, product_price_rupiah INTEGER,
            image_base TEXT, image_width INTEGER, image_height INTEGER, image_bytes INTEGER
        );
        CREATE TABLE affiliate_offer_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT, offer_id INTEGER NOT NULL,
            target_type TEXT NOT NULL, target_id INTEGER NOT NULL,
            UNIQUE (offer_id, target_type, target_id)
        );

        INSERT INTO areas (id, name) VALUES (2, 'DANDER');
        INSERT INTO cameras (id, name, area_id) VALUES (11, 'CCTV LAPANGAN DANDER', 2);
        INSERT INTO affiliate_partners (id, store_name, store_url, billing_mode)
        VALUES (1, 'Toko Satu', 'https://satu.example', 'term'),
               (2, 'Toko Dua', 'https://dua.example', 'term');
    `);
}

/** Satu tawaran yang hidup, mengincar kamera 11, di permukaan popup. */
function buatTawaran({ id, partner = 1, priority = 100, mode = 'camera', target = 11 }) {
    db.prepare(`
        INSERT INTO affiliate_offers (id, partner_id, product_title, product_url, target_mode, placements, priority)
        VALUES (?, ?, ?, ?, ?, '["popup"]', ?)
    `).run(id, partner, `Barang ${id}`, `https://toko.example/${id}`, mode, priority);
    if (mode !== 'all') {
        db.prepare('INSERT INTO affiliate_offer_targets (offer_id, target_type, target_id) VALUES (?, ?, ?)')
            .run(id, mode, target);
    }
}

const menangHariIni = () => resolveOfferForContext({ placement: 'popup', cameraId: 11 })?.id ?? null;

/** Pemenang untuk `n` hari berturut-turut mulai dari 2026-08-12. */
function pemenangSelama(n) {
    const keluar = [];
    for (let i = 0; i < n; i += 1) {
        const d = new Date(Date.UTC(2026, 7, 12 + i));
        jam.hariIni = d.toISOString().slice(0, 10);
        keluar.push(menangHariIni());
    }
    jam.hariIni = '2026-08-12';
    return keluar;
}

beforeEach(() => {
    resetSchema();
    jam.hariIni = '2026-08-12';
});

describe('tanpa seri, tidak ada yang berputar', () => {
    it('satu tawaran menang setiap hari, tanpa kecuali', () => {
        buatTawaran({ id: 4 });

        expect(new Set(pemenangSelama(40))).toEqual(new Set([4]));
    });

    it('spesifisitas tetap mengalahkan rotasi - kamera menang atas area, tiap hari', () => {
        buatTawaran({ id: 7, mode: 'area', target: 2 });
        buatTawaran({ id: 8, mode: 'camera', target: 11 });

        expect(new Set(pemenangSelama(40)), 'rotasi menembus urutan spesifisitas').toEqual(new Set([8]));
    });

    it('prioritas tetap mengalahkan rotasi - angka lebih kecil menang, tiap hari', () => {
        buatTawaran({ id: 21, priority: 10 });
        buatTawaran({ id: 22, priority: 50 });

        expect(new Set(pemenangSelama(40)), 'rotasi menembus urutan prioritas').toEqual(new Set([21]));
    });
});

describe('yang benar-benar seri BERGANTIAN', () => {
    it('dua tawaran seri: keduanya kebagian dalam 40 hari', () => {
        buatTawaran({ id: 31, partner: 1 });
        buatTawaran({ id: 32, partner: 2 });

        const pemenang = new Set(pemenangSelama(40));

        // Ini yang mustahil sebelum rotasi: 31 tidak akan pernah muncul, selamanya.
        expect(pemenang).toEqual(new Set([31, 32]));
    });

    it('tiga tawaran seri: ketiganya kebagian', () => {
        buatTawaran({ id: 41 });
        buatTawaran({ id: 42 });
        buatTawaran({ id: 43 });

        expect(new Set(pemenangSelama(120)).size).toBe(3);
    });

    it('pemenangnya STABIL dalam satu hari yang sama', () => {
        // Kalau tidak, satu pengunjung bisa melihat tawaran berbeda tiap kali membuka popup, dan
        // hitungan impresinya tersebar ke mitra yang tidak pernah benar-benar dilihat siapa pun.
        buatTawaran({ id: 51 });
        buatTawaran({ id: 52 });

        const sepuluhKali = Array.from({ length: 10 }, () => menangHariIni());

        expect(new Set(sepuluhKali).size, 'pemenangnya berubah-ubah di hari yang sama').toBe(1);
    });

    it('pembagiannya tidak timpang - tidak ada yang di bawah seperlima dalam 200 hari', () => {
        // Ini rotasi, BUKAN pembagian rata persis. Yang dijamin: tak ada yang praktis padam.
        buatTawaran({ id: 61 });
        buatTawaran({ id: 62 });

        const hitung = { 61: 0, 62: 0 };
        for (const id of pemenangSelama(200)) hitung[id] += 1;

        expect(hitung[61], 'tawaran 61 nyaris tidak pernah tampil').toBeGreaterThan(40);
        expect(hitung[62], 'tawaran 62 nyaris tidak pernah tampil').toBeGreaterThan(40);
    });
});

describe('tawaran mati tidak ikut giliran', () => {
    it('tawaran nonaktif tidak pernah menang, walaupun hari ini gilirannya', () => {
        buatTawaran({ id: 71 });
        buatTawaran({ id: 72 });
        db.prepare('UPDATE affiliate_offers SET active = 0 WHERE id = 72').run();

        expect(new Set(pemenangSelama(40))).toEqual(new Set([71]));
    });

    it('mitra nonaktif menarik tawarannya dari giliran', () => {
        buatTawaran({ id: 81, partner: 1 });
        buatTawaran({ id: 82, partner: 2 });
        db.prepare('UPDATE affiliate_partners SET active = 0 WHERE id = 2').run();

        expect(new Set(pemenangSelama(40))).toEqual(new Set([81]));
    });
});
