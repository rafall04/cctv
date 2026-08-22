/*
 * Purpose: Real-browser overflow smoke for the ADMIN surface — the half of the app the public
 *   overflow guard is structurally unable to see (see THE BLIND SPOT below).
 * Caller: playwright.config.js (npm run test:e2e; e2e job in CI).
 * Deps: @playwright/test, built dist served by vite preview; all /api/* mocked, external hosts blocked.
 * MainFuncs: admin-shell overflow assertions per admin page, at 393px and 320px, normal and 1.5x
 *   font; plus, whenever a dialog is on screen, the same assertions taken on the DIALOG PANEL —
 *   which <main> structurally cannot see (see measureAdminDialogs).
 * SideEffects: None outside the test browser (an admin session is faked in localStorage).
 *
 * THE BLIND SPOT THIS FILE EXISTS TO CLOSE (measured 2026-08, commit e16eb92)
 * ---------------------------------------------------------------------------
 * e2e/overflow.spec.js is correct for public pages and must stay exactly as it is. It cannot see
 * admin pages, for three stacked reasons — every one of them true at the same time:
 *
 *   1. Its PAGES list is public routes only; no /admin route was ever in it.
 *   2. src/index.css sets `overflow-x: clip` on BOTH html and body, so
 *      documentElement.scrollWidth reported a clean 320/320 across 80 measurements — including
 *      ones taken while the admin layout was genuinely 689px wide inside a 320px viewport.
 *   3. Its measure() skips any element with a scrolling ancestor (overflow auto/scroll/hidden/clip
 *      all count). AdminLayout renders `<main className="min-h-screen overflow-y-auto lg:ml-72">`,
 *      and `overflow-y: auto` computes `overflow-x: auto`, so EVERY element inside EVERY admin page
 *      is skipped by that helper.
 *
 * Net effect: the whole admin surface was invisible to the guard, and two blocking layout defects
 * shipped through it — a <fieldset> keeping the UA default `min-inline-size: min-content` (Tailwind
 * preflight never resets it) grew to 689px on a 320px viewport with the camera picker open, putting
 * the picker's search box 356px off screen; and an unbreakable 79-char filename in a <strong> did
 * the same at 584px. Both were fixed with `min-w-0` (+ `break-all` on the filename).
 *
 * So this file does NOT reuse the public measure(). It measures the scroll container itself.
 *
 * And a THIRD layer swallows it once a dialog opens: ui/Modal is `fixed inset-0` and out of flow,
 * so it contributes nothing to <main> either. That one gets its own measurement — the long note
 * above measureAdminDialogs, with the RED/GREEN proof that it can actually fail.
 *
 * WHAT IT FOUND WHEN IT FIRST RAN — 24 real defects across 11 pages, all since fixed (f31879b).
 * Most of them appeared ONLY at 1.5x root font, which is why that second measurement pass exists
 * and why it must not be dropped: an accessibility font size is the main case here, not the edge.
 *
 * WHAT THE DIALOG MEASUREMENT FOUND THE FIRST TIME IT RAN — NOT a flake, do not silence it
 * ---------------------------------------------------------------------------------------
 * Adding measureAdminDialogs (below) turned up a defect of that exact same family, sitting in the
 * one admin form that had ALREADY gone through ui/Modal — i.e. in the part of the surface no
 * measurement in this file could previously reach:
 *
 *   - src/pages/VoucherManagement.jsx:547 — the "Area yang dibuka" <fieldset> has no `min-w-0`, so
 *     it keeps the UA default `min-inline-size: min-content` (Tailwind preflight never resets it —
 *     the same defect that produced the 689px affiliate bug). At 320px with 24px root font its
 *     area list measures 353px inside a 318px dialog body: the dialog scrolls sideways and the
 *     checkbox column runs 34px off the panel edge. Clean at 393px and clean at normal font, like
 *     every other defect in this family. One `min-w-0` on the <fieldset> fixes it.
 *
 * That is a src change and deliberately out of this file's scope. Until it lands, `npm run
 * test:e2e` reports exactly ONE failure here — 92 passed, 1 failed — and it names its own culprit.
 */

import { test, expect } from '@playwright/test';

/* ------------------------------------------------------------------ fixtures
 *
 * REALISTIC WORST CASE, NOT EMPTY.
 *
 * An empty admin page cannot overflow: no rows, no picker, no long token, nothing wider than its
 * box. Empty fixtures here would produce a green suite that proves nothing — the same vacuity trap
 * that let the 2026-08 public-strip bug through (see the expectStrip comment in overflow.spec.js).
 * The audit's numbers came from an 85-char store name and a 750-camera picker, so those are the
 * shapes fed back in.
 */

/* Area names deliberately match the LONGEST shape the public spec already treats as realistic
 * ('KEC BOJONEGORO DAN SEKITARNYA', 29 chars) rather than an invented monster — a <select> is sized
 * by its widest <option>, so this fixture decides how hard the camera filter row is pushed and an
 * unrealistic value here would manufacture a failure instead of finding one. */
const AREA_NAMES = [
    'KEC BOJONEGORO DAN SEKITARNYA',
    'KAB MAGETAN',
    'DANDER',
    'TANJUNGHARJO',
    'KEC KAPAS DAN SEKITARNYA',
    'KEC BALEN',
];

/* Long enough that the picker row's `whitespace-nowrap` (from `truncate`) makes its min-content
 * width the FULL string — which is precisely what a fieldset without min-w-0 inflates to. */
const cameraName = (i) =>
    `SIMPANG EMPAT JALAN RAYA NAMA KAMERA YANG SENGAJA SANGAT PANJANG SEKALI NOMOR ${String(i).padStart(4, '0')}`;

/* 750 to match the audit exactly. TargetPicker caps the rendered list at 200, so the extra rows
 * only change the "Menampilkan 200 dari 750" line — but the cap is part of what is being measured,
 * and a fixture under 200 would never render it. */
const ADMIN_CAMERAS = Array.from({ length: 750 }, (_, i) => ({
    id: i + 1,
    name: cameraName(i + 1),
    location: `JL. LOKASI PANJANG DESA CONTOH KECAMATAN CONTOH NOMOR ${i + 1}`,
    area_id: (i % 6) + 1,
    area_name: AREA_NAMES[i % AREA_NAMES.length],
    stream_url: `http://127.0.0.1:4173/hls/kamera-dengan-nama-stream-key-yang-panjang-${i + 1}/index.m3u8`,
    camera_class: 'community',
    status: i % 7 === 0 ? 'inactive' : 'active',
    enabled: i % 5 === 0 ? 0 : 1,
    is_online: i % 3 === 0 ? 0 : 1,
    is_published: 1,
    live_viewers: i % 11,
    total_views: 1000 + i,
    resolution: '1920x1080',
    codec: 'h265',
    /* Four in five record, as in production. Load-bearing beyond realism: the admin playback page
     * filters /api/cameras down to `enable_recording` and renders "Belum Ada Recording Tersedia"
     * for an empty result — i.e. without this field that whole page measures an empty box. */
    enable_recording: i % 5 === 0 ? 0 : 1,
    recording_duration_hours: [4, 8, 24, 72][i % 4],
}));

const ADMIN_AREAS = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    name: AREA_NAMES[i % AREA_NAMES.length],
    slug: `area-${i + 1}`,
    camera_count: 12 + i,
    total_views: 5000 + i,
    description: 'Deskripsi area yang panjang supaya kartunya terisi seperti di produksi.',
}));

/* 85-char store name — the exact class of value the audit measured 605px on. */
const AFFILIATE_PARTNERS = [
    {
        id: 1,
        store_name: 'TOKO KAMERA PENGAWAS DAN AKSESORIS JARINGAN SERBA ADA CABANG BOJONEGORO PUSAT SATU',
        store_url: 'https://tokopedia.example.com/toko-kamera-pengawas-dan-aksesoris-jaringan-serba-ada/etalase/kamera-ip-3mp-outdoor-anti-air',
        contact_name: 'Bapak Penanggung Jawab Kemitraan Wilayah Timur',
        billing_mode: 'lifetime',
        price_rupiah: 0,
        active: 1,
        note: 'Catatan kesepakatan yang panjang supaya barisnya terisi seperti data sungguhan.',
    },
    {
        id: 2,
        store_name: 'CV SUMBER REJEKI ELEKTRONIK DAN PERKAKAS TEKNIK MANDIRI SEJAHTERA ABADI',
        store_url: 'https://shopee.example.com/sumber-rejeki-elektronik-perkakas-teknik-mandiri/produk/adaptor-poe-gigabit-48v',
        contact_name: 'Ibu Manajer Penjualan',
        billing_mode: 'term',
        price_rupiah: 250000,
        active: 0,
        note: 'Berjangka, jatuh tempo tiap bulan.',
    },
];

const AFFILIATE_OFFERS = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    partner_id: (i % 2) + 1,
    product_title: `KAMERA IP OUTDOOR 3MP ANTI AIR DENGAN AUDIO DUA ARAH DAN LAMPU SOROT NOMOR ${i + 1}`,
    description: 'Deskripsi barang yang panjang, seperti yang benar-benar diketik operator ketika '
        + 'menjelaskan isi paket beserta kelengkapan dan garansinya.',
    /* One unbreakable ~120-char token: the same failure shape as the 79-char filename defect. */
    product_url: `https://tokopedia.example.com/toko-kamera-pengawas/produk-kamera-ip-outdoor-3mp-anti-air-audio-dua-arah-lampu-sorot-varian-${i + 1}`,
    product_price_rupiah: 385000 + i * 1000,
    whatsapp_number: '628123456789',
    whatsapp_message: 'Halo, saya mau tanya soal kamera yang tampil di CCTV publik.',
    placements: ['popup'],
    /* The FIRST row is camera-targeted on purpose: clicking its "Ubah" opens the editor with the
     * 750-camera picker already rendered, which is the state both defects were found in. */
    target_mode: i === 0 ? 'camera' : (i % 3 === 1 ? 'area' : 'all'),
    camera_ids: i === 0 ? [1, 2, 3, 4, 5] : [],
    area_ids: i % 3 === 1 ? [1, 2] : [],
    priority: 100 + i,
    active: i % 2 === 0 ? 1 : 0,
    image_base: null,
}));

const LANDING_SETTINGS = {
    area_coverage: 'Wilayah layanan mencakup banyak kecamatan dengan nama yang panjang sekali',
    hero_badge: 'PEMANTAUAN CCTV PUBLIK KABUPATEN',
    section_title: 'Daftar kamera pemantauan lalu lintas dan fasilitas umum',
    eventBanner: {
        enabled: true,
        title: 'PENGUMUMAN KEGIATAN',
        text: 'Teks spanduk kegiatan yang panjang supaya kotak isiannya benar-benar terisi.',
        theme: 'national',
        start_at: '2026-08-01 00:00',
        end_at: '2026-08-31 23:59',
        show_in_full: true,
        show_in_simple: true,
    },
    announcement: {
        enabled: true,
        title: 'INFORMASI PEMELIHARAAN',
        text: 'Teks pengumuman yang panjang supaya kotak isiannya benar-benar terisi juga.',
        style: 'warning',
        start_at: '2026-08-10 00:00',
        end_at: '2026-08-12 23:59',
        show_in_full: true,
        show_in_simple: false,
    },
};

/* ------------------------------------------------- fixtures, part 2: the rest of the surface
 *
 * The three pages above were the audit's starting point. Everything below was added when coverage
 * was extended to every remaining /admin route that renders a list or a form (27 more), and the
 * same anti-vacuity rule governs it: an empty admin page cannot overflow, so a fixture that renders
 * "Belum ada data" is worth exactly nothing. Four pages proved that the hard way — /admin/dashboard,
 * /admin/analytics, /admin/playback-analytics and /admin/recordings each threw a TypeError and
 * rendered the ErrorBoundary when handed `data: []`, because they read `data.summary.totalCameras`,
 * `data.pagination.pageSize`, `data.rate.source` and so on. A page showing an error card measures
 * clean and tells you nothing, which is why every page here has a `ready` selector keyed to real
 * rendered content rather than to a heading that exists either way.
 *
 * The recurring worst-case shapes, in order of how often they actually broke something:
 *   1. an unbreakable token (URL / filename / stream key / IPv6 / user-agent) with no break-all;
 *   2. a <select> whose min-content width is its widest <option> (see the CameraManagement note);
 *   3. a long human name in a flex/grid child that has no min-w-0.
 * So those three appear on every page that can hold them.
 */

/* One unbreakable ~120-char URL and one ~78-char filename — the exact two shapes that produced the
 * 689px and 584px defects this file was created for. */
const LONG_URL = 'https://cctv.example.invalid/arsip/rekaman/kamera-simpang-empat-jalan-raya-bojonegoro-selatan/2026-08-22T07-40-00_segmen-0001.mp4';
const LONG_FILENAME = 'camera1169_2026-08-22T07-40-00_sampai_07-50-00_segmen-rekaman-0001.mp4';
/* Full-length IPv6 and a real mobile UA: both are single unbreakable tokens in log tables. */
const LONG_IPV6 = '2404:8000:1027:8a3c:1c2b:9f4d:aa71:3e02';
const LONG_UA = 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const LONG_EMAIL = 'operator.kecamatan.bojonegoro.selatan@dinaskominfo-kabupaten.example.go.id';
const LONG_PERSON = 'Bapak Penanggung Jawab Kemitraan Wilayah Timur Kabupaten';
const LONG_USERNAME = 'operator_kecamatan_bojonegoro_selatan_01';

const ADMIN_USERS = Array.from({ length: 24 }, (_, i) => ({
    id: i + 1,
    username: i === 0 ? LONG_USERNAME : `operator_wilayah_${String(i + 1).padStart(2, '0')}`,
    email: LONG_EMAIL,
    phone: '628123456789',
    role: ['admin', 'viewer', 'customer', 'operator'][i % 4],
    created_at: '2026-08-01 09:15:00',
}));

const FEEDBACK_ITEMS = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    name: `Pengunjung Dengan Nama Yang Panjang Sekali Nomor ${i + 1}`,
    email: LONG_EMAIL,
    message: 'Kamera di simpang empat jalan raya sering buram ketika malam hari dan suaranya tidak '
        + `keluar sama sekali, mohon diperiksa petugas. Tautan buktinya ${LONG_URL}`,
    status: ['unread', 'read', 'resolved'][i % 3],
    created_at: '2026-08-20 07:45:00',
}));

const SECURITY_LOGS = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    event_type: ['login_failed', 'rate_limit_exceeded', 'csrf_validation_failed', 'access_denied', 'admin_action'][i % 5],
    username: i === 0 ? LONG_USERNAME : `operator_wilayah_${String(i + 1).padStart(2, '0')}`,
    ip_address: LONG_IPV6,
    endpoint: '/api/admin/billing/subscriptions/1249/perpanjangan-otomatis-bulanan',
    user_agent: LONG_UA,
    details: JSON.stringify({
        reason: 'invalid_password', endpoint_type: 'admin', required_role: 'admin',
        actual_role: 'viewer', target_type: 'camera', target_id: 1169, lock_type: 'ip',
    }),
    timestamp: '2026-08-22 07:41:03',
}));

const HEALTH_DEBUG = {
    summary: { total: 750, healthy: 612, degraded: 61, offline: 58, unresolved: 19 },
    pagination: { page: 1, limit: 25, total: 750, totalPages: 30 },
    items: Array.from({ length: 25 }, (_, i) => ({
        cameraId: i + 1,
        cameraName: cameraName(i + 1),
        areaName: AREA_NAMES[i % AREA_NAMES.length],
        state: ['healthy', 'degraded', 'unresolved', 'suspect'][i % 4],
        confidence: 0.72,
        errorClass: 'rtsp_connect_timeout_after_three_retries',
        availability_state: i % 3 ? 'online' : 'offline',
        effectiveOnline: i % 3 !== 0,
        healthMode: 'internal_probe_with_runtime_evidence',
        healthStrategy: 'runtime_evidence_then_probe_then_fallback',
        policy_mode: 'on_demand',
        source_profile: 'internal_rtsp_h265_substream_720p',
        lastReason: 'runtime_reader_absent_and_probe_failed',
        failureScore: 3.5,
        /* Unbreakable, and the panel renders these with break-all — so this is the fixture that
         * proves break-all is actually doing its job rather than being decorative. */
        runtimeTarget: `rtsp://127.0.0.1:8554/kamera-simpang-empat-bojonegoro-selatan-${i + 1}/substream`,
        probeTarget: `${LONG_URL}?probe=${i + 1}`,
        fallbackTarget: `http://127.0.0.1:8888/kamera-simpang-empat-bojonegoro-selatan-${i + 1}/index.m3u8`,
        providerDomain: 'origin-hls-provider-eksternal-yang-panjang.example.invalid',
        probeMethod: 'HEAD',
        httpStatus: 404,
        contentType: 'application/vnd.apple.mpegurl',
        usedFallback: i % 2 === 0,
        configured: true,
        ready: i % 3 !== 0,
        sourceReady: i % 3 !== 0,
        readerCount: i % 4,
        realViewerCount: i % 3,
        deliveryType: 'hls_proxy',
        lastProbeAt: '2026-08-22T07:41:03.000Z',
        lastRuntimeSuccessAt: '2026-08-22T07:39:11.000Z',
        lastRuntimeFreshAt: '2026-08-22T07:39:11.000Z',
        lastRuntimeSignalType: 'reader_bytes_advanced',
        runtimeGraceUntil: '2026-08-22T07:45:00.000Z',
        domainBackoffUntil: '2026-08-22T08:10:00.000Z',
        monitoring_state: 'active',
        monitoring_reason: 'published_and_enabled',
        availability_reason: 'probe_failed_after_runtime_absent',
        availability_confidence: 0.68,
        close_after_seconds: 60,
    })),
};

const DASHBOARD_STATS = {
    summary: { totalCameras: 750, activeCameras: 612, disabledCameras: 138, totalAreas: 40, activeViewers: 97 },
    system: {
        platform: 'linux', arch: 'x64', cpus: 8,
        cpuModel: 'Intel(R) Xeon(R) Gold 6248R CPU @ 3.00GHz dengan nama panjang sekali',
        cpuLoad: 47, totalMem: 67_553_994_752, freeMem: 42_949_672_960, usedMem: 24_604_321_792,
        memUsagePercent: 36, uptime: 986_400, loadAvg: [1.24, 1.08, 0.97],
    },
    streams: Array.from({ length: 24 }, (_, i) => ({
        id: i + 1,
        name: cameraName(i + 1),
        ready: i % 3 !== 0,
        state: ['ready', 'buffering', 'offline', 'maintenance'][i % 4],
        viewers: i % 11,
        sessions: i % 4 === 0 ? [{
            sessionId: `sess-${i}-panjang-sekali-abcdef0123456789`,
            ipAddress: LONG_IPV6, deviceType: 'mobile',
            startedAt: '2026-08-22T07:30:00.000Z', durationSeconds: 412,
        }] : [],
        bytesReceived: 128_000_000 + i, bytesSent: 512_000_000 + i,
        streamSource: 'internal', operationalState: ['online', 'offline', 'maintenance'][i % 3],
    })),
    recentLogs: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        action: 'camera_updated_by_admin_via_bulk_policy_editor',
        username: LONG_USERNAME,
        details: `Kamera "${cameraName(i + 1)}" diubah kelasnya menjadi community`,
        created_at: '2026-08-22 07:41:03',
        created_at_wib: '22 Agu 2026 14:41 WIB',
    })),
    mtxConnected: true,
    cameraStatusBreakdown: { online: 612, offline: 121, maintenance: 17 },
    topCameras: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: cameraName(i + 1), viewers: 30 - i })),
    allSessions: Array.from({ length: 30 }, (_, i) => ({
        sessionId: `sess-${i}-panjang-sekali-abcdef0123456789`,
        cameraId: i + 1, cameraName: cameraName(i + 1),
        ipAddress: LONG_IPV6, deviceType: ['mobile', 'desktop', 'tablet'][i % 3],
        startedAt: '2026-08-22T07:30:00.000Z', durationSeconds: 412 + i,
    })),
};

/* QuickStatsCards reads a DIFFERENT stats object from the same page (getTodayStats), keyed on
 * `current`/`comparison` rather than `summary` — hence a second fixture on the same route family. */
const TODAY_STATS = {
    current: { totalSessions: 18_432, uniqueViewers: 7_211, avgDuration: 268, totalWatchTime: 4_939_776, activeNow: 97 },
    compare: { totalSessions: 16_002, uniqueViewers: 6_540, avgDuration: 241, totalWatchTime: 3_856_482 },
    comparison: { sessionsChange: 15.2, viewersChange: 10.3, durationChange: 11.2 },
    cameras: { total: 750, online: 612, offline: 121, maintenance: 17 },
    period: 'today',
};

const ANALYTIC_SESSIONS = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1,
    session_id: `sess-${i}-panjang-sekali-abcdef0123456789`,
    camera_id: i + 1,
    camera_name: cameraName(i + 1),
    ip_address: LONG_IPV6,
    device_type: ['mobile', 'desktop', 'tablet'][i % 3],
    user_agent: LONG_UA,
    started_at: '2026-08-22T07:30:00.000Z',
    ended_at: '2026-08-22T07:37:00.000Z',
    duration_seconds: 412 + i,
}));

const VIEWER_ANALYTICS = {
    overview: { totalSessions: 18_432, uniqueViewers: 7_211, avgDuration: 268, totalWatchTime: 4_939_776, activeNow: 97 },
    comparison: { sessionsChange: 15.2, viewersChange: 10.3, durationChange: 11.2 },
    charts: { daily: Array.from({ length: 14 }, (_, i) => ({ date: `2026-08-${String(i + 8).padStart(2, '0')}`, sessions: 1200 + i * 13, uniqueViewers: 540 + i * 7 })) },
    recentSessions: ANALYTIC_SESSIONS,
    topCameras: Array.from({ length: 10 }, (_, i) => ({
        camera_id: i + 1, camera_name: cameraName(i + 1),
        total_views: 4000 - i * 90, unique_viewers: 1800 - i * 40, total_watch_time: 900_000 - i * 1000,
    })),
    deviceBreakdown: [
        { device_type: 'mobile', count: 12_884, percentage: 69.9 },
        { device_type: 'desktop', count: 4_102, percentage: 22.3 },
        { device_type: 'tablet', count: 1_446, percentage: 7.8 },
    ],
    topVisitors: Array.from({ length: 10 }, (_, i) => ({
        ip_address: LONG_IPV6, total_sessions: 210 - i * 8, cameras_watched: 24 - i, total_watch_time: 120_000 - i * 900,
    })),
    peakHours: Array.from({ length: 24 }, (_, i) => ({ hour: i, sessions: 200 + ((i * 37) % 900), unique_visitors: 80 + ((i * 13) % 400) })),
    cameraPerformance: [],
};

const HISTORY_PAGE = {
    items: ANALYTIC_SESSIONS,
    pagination: { page: 1, pageSize: 25, totalItems: 18_432, totalPages: 738 },
    summary: { totalItems: 18_432, uniqueViewers: 7_211, totalWatchTime: 4_939_776 },
};

const PLAYBACK_TOKENS = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    label: `Token Keluarga Bapak ${LONG_PERSON} Nomor ${i + 1}`,
    token_prefix: `VVC9E2XA${String(i).padStart(4, '0')}`,
    scope_type: ['all', 'camera', 'area'][i % 3],
    camera_ids: i % 3 === 1 ? [1, 2, 3, 4, 5, 6, 7, 8] : [],
    allowed_camera_ids: i % 3 === 1 ? [1, 2, 3, 4, 5, 6, 7, 8] : [],
    camera_rules: i % 3 === 1 ? [{ camera_id: 1, enabled: true, playback_window_hours: 72, note: 'Kamera depan rumah' }] : [],
    playback_window_hours: 72,
    expires_at: '2026-12-31 23:59:59',
    is_active: i % 4 !== 3,
    active_session_count: i % 3,
    session_timeout_seconds: 1800,
    max_active_sessions: 3,
    client_note: `Catatan klien yang panjang untuk ${LONG_PERSON}`,
    share_template: `Halo, ini tautan rekaman CCTV Anda: ${LONG_URL}`,
}));

const PLAYBACK_TOKEN_AUDIT = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    event_type: ['token_created', 'token_revoked', 'session_started', 'session_denied', 'share_regenerated'][i % 5],
    token_label: `Token Keluarga Bapak ${LONG_PERSON} Nomor ${(i % 12) + 1}`,
    token_prefix: `VVC9E2XA${String(i % 12).padStart(4, '0')}`,
    actor_username: LONG_USERNAME,
    camera_id: (i % 12) + 1,
    camera_name: cameraName((i % 12) + 1),
    ip_address: LONG_IPV6,
    user_agent: LONG_UA,
    detail_json: JSON.stringify({ preset: 'client_30_hari', camera_count: 8, timeout_seconds: 1800, max_active_sessions: 3, share_key_prefix: 'VVC9E2XA', reason: 'expired', reused: false, cleared: 2 }),
    created_at: '2026-08-22 07:41:03',
}));

const PLAYBACK_PRODUCTS = {
    coverage: { hours: 168, oldestSegmentAt: '2026-08-15T00:00:00.000Z' },
    products: Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        key: `paket_akses_playback_bulanan_wilayah_${i + 1}`,
        label: i === 0 ? 'Coba Gratis 1 Hari Untuk Pengunjung Baru' : `Paket Akses Playback ${30 * i} Hari Wilayah Kabupaten`,
        description: 'Bisa memutar ulang rekaman kamera publik sejauh jendela yang tertera, dengan '
            + 'tautan yang bisa dibagikan ke anggota keluarga lain.',
        price_rupiah: i === 0 ? 0 : 25_000 * i,
        window_hours: 24 * (i + 1),
        coverage_hours: 168,
        validity_days: 30 * (i || 1),
        sort_order: i,
        is_trial: i === 0,
        enabled: i % 2 === 0,
        exceeds_coverage: i === 4,
    })),
};

const CAMERA_REPORTS = {
    pagination: { page: 1, limit: 25, total: 214, totalPages: 9 },
    summary: {
        total: 214, open: 63,
        byStatus: { baru: 41, dibaca: 22, selesai: 151 },
        byCategory: { buram: 41, mati: 12, arah_salah: 10 },
    },
    categories: [
        { key: 'buram', label: 'Gambar buram atau berbayang' },
        { key: 'mati', label: 'Kamera mati total' },
        { key: 'arah_salah', label: 'Arah kamera bergeser dari semestinya' },
    ],
    cameras: ADMIN_CAMERAS.slice(0, 40).map((c) => ({ id: c.id, name: c.name, reports: 3 })),
    reports: Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        cameraId: i + 1,
        cameraName: cameraName(i + 1),
        areaName: AREA_NAMES[i % AREA_NAMES.length],
        categoryLabel: 'Arah kamera bergeser dari semestinya',
        message: 'Sejak kemarin sore gambarnya menghadap ke tembok, padahal biasanya menghadap ke '
            + `simpang. Saya sudah coba buka lewat tautan ${LONG_URL} dan hasilnya sama saja.`,
        status: ['baru', 'dibaca', 'selesai'][i % 3],
        createdAt: '2026-08-22T07:41:03.000Z',
        occurredAt: '2026-08-21T17:20:00.000Z',
    })),
};

const CAMERA_REACTIONS = {
    totals: { cameras: 750, rated: 318, likes: 4_812, dislikes: 671 },
    cameras: ADMIN_CAMERAS.slice(0, 60).map((c, i) => ({
        id: c.id,
        name: c.name,
        areaName: c.area_name,
        enabled: i % 5 !== 0,
        likes: 200 - i,
        dislikes: i % 17,
        total: 200 - i + (i % 17),
        lastVoteAt: '2026-08-22T07:41:03.000Z',
    })),
};

const NOTIF_RUNS = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    cameraName: cameraName(i + 1),
    eventType: i % 2 ? 'offline' : 'online',
    success: i % 4 !== 3,
    sentCount: i % 3,
    targetCount: 2,
    skippedReason: i % 4 === 3 ? 'camera_area_tidak_termasuk_dalam_lingkup_peringatan_telegram' : null,
    createdAt: '2026-08-22 07:41:03',
}));

const SPONSOR_PACKAGES = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    key: `paket_sponsor_wilayah_kabupaten_bojonegoro_${i + 1}`,
    name: `Paket Sponsor Utama Wilayah Kabupaten Bojonegoro ${i + 1}`,
    color: ['#2563eb', '#16a34a', '#f59e0b', '#dc2626'][i],
    default_price: 500_000 * (i + 1),
    default_camera_limit: 5 * (i + 1),
    features: ['Logo di bawah video live', 'Nama di daftar kamera', 'Tautan ke toko'],
    sort_order: i,
    sponsor_count: 3 + i,
}));

const SPONSORS = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    name: `CV SUMBER REJEKI ELEKTRONIK DAN PERKAKAS TEKNIK MANDIRI SEJAHTERA ${i + 1}`,
    package: `paket_sponsor_wilayah_kabupaten_bojonegoro_${(i % 4) + 1}`,
    package_name: SPONSOR_PACKAGES[i % 4].name,
    package_color: SPONSOR_PACKAGES[i % 4].color,
    contact_name: LONG_PERSON,
    contact_email: LONG_EMAIL,
    contact_phone: '628123456789',
    url: LONG_URL,
    logo: `${LONG_URL}#logo-${i + 1}.png`,
    price: 500_000 * ((i % 4) + 1),
    camera_limit: 5 * ((i % 4) + 1),
    camera_count: i % 6,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    active: i % 5 !== 0,
    notes: 'Catatan kesepakatan yang panjang supaya barisnya terisi seperti data sungguhan.',
}));

const SPONSOR_STATS = { total_sponsors: 12, active_sponsors: 9, monthly_revenue: 7_500_000, expiring_soon: 2 };

const PROMO_BANNERS = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    title: `PROMO PEMASANGAN CCTV RUMAH DAN TOKO GRATIS SURVEI WILAYAH ${i + 1}`,
    image_base: `/api/promo-media/promo-pemasangan-cctv-wilayah-kabupaten-${i + 1}`,
    target_mode: ['all', 'area', 'camera'][i % 3],
    camera_ids: i % 3 === 2 ? [1, 2, 3, 4, 5] : [],
    area_ids: i % 3 === 1 ? [1, 2] : [],
    placements: ['popup', 'landing', 'playback'],
    start_date: '2026-08-01',
    end_date: '2026-09-30',
    schedule_state: ['live', 'scheduled', 'ended'][i % 3],
    is_live: i % 3 === 0,
    total_impressions: 128_400 + i * 37,
    total_clicks: 2_140 + i * 3,
}));

const RECORDING_OVERVIEW = {
    cameras: ADMIN_CAMERAS.slice(0, 30).map((c, i) => ({
        id: c.id,
        camera_id: c.id,
        name: c.name,
        camera_name: c.name,
        location: c.location,
        enabled: 1,
        enable_recording: i % 4 !== 3 ? 1 : 0,
        recording_duration_hours: [4, 8, 24, 72][i % 4],
        stream_source: 'internal',
        runtime_status: ['recording', 'idle', 'error'][i % 3],
        segment_count: 1_432 - i,
        total_size: 42_949_672_960 - i * 1000,
        oldest_segment: '2026-08-15T00:00:00.000Z',
        newest_segment: '2026-08-22T07:40:00.000Z',
        storage: { total_size: 42_949_672_960 - i * 1000, oldest_segment: '2026-08-15T00:00:00.000Z', newest_segment: '2026-08-22T07:40:00.000Z' },
    })),
};

const RECORDING_HEALTH = {
    generatedAt: '2026-08-22T07:41:03.000Z',
    status: { level: 'warn', reasons: ['antrian_recovery_menumpuk_lebih_dari_lima_puluh_berkas', 'dua_kamera_gagal_restart_berturut_turut'] },
    scheduler: { running: true, tasks: [{ name: 'recording_segment_rotator_setiap_sepuluh_menit', healthy: true, lastRun: '2026-08-22T07:40:00.000Z' }] },
    recovery: { queue: { queued: 51, oldestAgeSeconds: 4820 }, diagnostics: { active: 12, terminal: 3 } },
    restarts: { last24h: { total: 18, succeeded: 16, failed: 2 } },
};

const RECORDING_CAPACITY = {
    cameras: 30,
    rate: { source: 'measured', bytesPerCameraHour: 1_395_864_371, sampleCameras: 11, sampleHours: 168 },
    disk: { usedByRecordingsBytes: 96_636_764_160, freeBytes: 118_111_600_640, reservedBytes: 21_474_836_480, safeBytes: 96_636_764_160 },
    retention: { currentHours: 72 },
    projections: [4, 8, 24, 72, 168].map((hours) => ({ hours, bytes: 1_395_864_371 * 30 * hours, fits: hours <= 24, isCurrent: hours === 72 })),
};

const RECORDING_RESTARTS = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    camera_name: cameraName(i + 1),
    reason: 'segmen_nol_byte_terdeteksi_tiga_kali_berturut_turut_pada_pipa_ffmpeg',
    restart_time: '2026-08-22 07:20:00',
    recovery_time: '2026-08-22 07:20:35',
    success: i % 5 !== 4,
}));

const RECORDING_ASSURANCE = {
    summary: { cameras: 30, recording: 26, total: 30 },
    cameras: ADMIN_CAMERAS.slice(0, 30).map((c, i) => ({
        id: c.id,
        name: c.name,
        health: ['ok', 'warn', 'fault'][i % 3],
        reasons: i % 3 ? ['jeda_rekaman_melebihi_ambang_batas_yang_diizinkan'] : [],
        recent_gap: { gap_count: i % 3, max_gap_seconds: 180 * (i % 3) },
        seconds_since_latest_end: 45 + i,
    })),
};

const BILLING_CUSTOMERS = Array.from({ length: 18 }, (_, i) => ({
    id: i + 1,
    username: i === 0 ? LONG_USERNAME : `pelanggan_wilayah_${String(i + 1).padStart(2, '0')}`,
    email: LONG_EMAIL,
    phone: '628123456789',
    balance: 250_000 - i * 1000,
    account_status: ['active', 'suspended'][i % 2],
    camera_count: i % 5,
    plan_key: `paket_sewa_cctv_bulanan_wilayah_kabupaten_${(i % 3) + 1}`,
    plan_is_trial: i % 7 === 0,
    plan_max_cameras: 5,
    trial_ends_at: '2026-09-01',
    suspended_subscriptions: i % 3,
}));

const BILLING_SUBSCRIPTIONS = Array.from({ length: 18 }, (_, i) => ({
    id: i + 1,
    customer_username: BILLING_CUSTOMERS[i % BILLING_CUSTOMERS.length].username,
    camera_name: cameraName(i + 1),
    area_name: AREA_NAMES[i % AREA_NAMES.length],
    camera_is_online: i % 3 !== 0,
    camera_is_public: 0,
    monthly_price: 150_000,
    status: ['active', 'suspended'][i % 2],
    wallet_balance: 250_000 - i * 1000,
}));

const BILLING_PAYMENTS = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1,
    user_id: (i % 18) + 1,
    username: BILLING_CUSTOMERS[i % BILLING_CUSTOMERS.length].username,
    amount: 150_000,
    gateway: 'tripay_qris_bank_transfer_virtual_account',
    status: ['paid', 'pending', 'failed'][i % 3],
    failure_reason: i % 3 === 2 ? 'kadaluarsa_sebelum_pembayaran_diselesaikan_oleh_pelanggan' : null,
    created_at: '2026-08-22 07:41:03',
}));

const BILLING_PLANS = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    key: `paket_sewa_cctv_bulanan_wilayah_kabupaten_${i + 1}`,
    name: `Paket Sewa CCTV Bulanan Wilayah Kabupaten Bojonegoro ${i + 1}`,
    monthly_price: 150_000 * (i + 1),
    max_cameras: 5 * (i + 1),
    is_trial: i === 0,
    trial_days: i === 0 ? 7 : 0,
    active: 1,
}));

const BILLING_REGISTRATIONS = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    username: `calon_pelanggan_wilayah_${String(i + 1).padStart(2, '0')}`,
    email: LONG_EMAIL,
    phone: '628123456789',
    plan_name: BILLING_PLANS[i % 4].name,
    plan_is_trial: i % 4 === 0,
    plan_trial_days: 7,
    created_at: '2026-08-22 07:41:03',
}));

const BILLING_CAMERA_IPS = {
    summary: { total: 42, public_count: 31, private_count: 9, unresolved_count: 2 },
    public_ips: Array.from({ length: 31 }, (_, i) => `114.79.${i}.${(i * 7) % 250}`),
    endpoints: Array.from({ length: 42 }, (_, i) => ({
        camera_id: i + 1,
        camera_name: cameraName(i + 1),
        customer_username: BILLING_CUSTOMERS[i % BILLING_CUSTOMERS.length].username,
        host: i % 5 === 0 ? LONG_IPV6 : `114.79.${i}.${(i * 7) % 250}`,
        port: 554,
        kind: ['public', 'private', 'invalid'][i % 3],
    })),
};

const VOUCHER_PROFILES = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    name: `Profil Voucher Harian Wilayah Kecamatan Bojonegoro Selatan ${i + 1}`,
    description: 'Berlaku untuk semua kamera di area berbayar yang dipilih, sekali pakai per kode.',
    duration_minutes: 60 * (i + 1),
    code_validity_days: 30,
    max_uses_per_code: 1,
    price: 5_000 * (i + 1),
    online_purchasable: i % 2 === 0,
    area_ids: [1, 2, 3],
    active: i % 3 !== 2,
}));

const VOUCHER_CODES = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    code: `RAFCCTV-${String(i + 1).padStart(4, '0')}-XKQP-9F2D`,
    profile_id: (i % 6) + 1,
    buyer_name: `Pembeli Dengan Nama Yang Panjang Sekali Nomor ${i + 1}`,
    buyer_phone: '628123456789',
    status: ['unused', 'redeemed', 'revoked'][i % 3],
    redeemed_count: i % 2,
    expires_at: '2026-12-31 23:59:59',
}));

const VOUCHER_SETTINGS = { enabled: true, gated_area_ids: [1, 2, 3] };

const RONDA_CAMERAS = {
    available: true,
    kesiapan: { kurang: [], perlu_disetel: ['camera1169 belum punya grup Telegram tujuan'] },
    cameras: Array.from({ length: 6 }, (_, i) => ({
        name: `camera${1169 + i}`,
        status: { online: i % 3 !== 0, sourceOk: i % 4 !== 3, reconnects: i % 5, eventsToday: 12 + i },
        config: {
            label: cameraName(i + 1),
            area: AREA_NAMES[i % AREA_NAMES.length],
            enabled: i % 4 !== 3,
            alert_hours: '22:00-04:00',
            tg_cooldown: 12, tg_cooldown_off: 300,
            chat_id: '-1002345678901',
            confirm_classes: 'person,car,motorcycle',
            min_area: 700, confirm_conf: 0.15, proc_w: 960, target_fps: 5,
            crop_limit: '0,0,1,1', retention_days: 7, max_snaps: 50,
            ignore: [[[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]]],
            roi: [[[0.4, 0.4], [0.9, 0.4], [0.9, 0.9], [0.4, 0.9]]],
        },
    })),
};

const RONDA_AVAILABLE = ADMIN_CAMERAS.slice(0, 40).map((c) => ({ id: c.id, name: c.name, area: c.area_name }));

const VEHICLE_CAMERAS = Array.from({ length: 6 }, (_, i) => ({
    camera_id: i + 1,
    nama_kamera: cameraName(i + 1),
    aktif: i % 4 !== 3,
    berjalan: i % 3 === 0,
    garis: [{ nama: `Garis hitung arah utara menuju selatan ${i + 1}`, a: [0.1, 0.5], b: [0.9, 0.5] }],
}));

const VEHICLE_AVAILABLE = ADMIN_CAMERAS.slice(0, 40).map((c, i) => ({ id: c.id, name: c.name, sudah_diatur: i < 6 }));

const VEHICLE_DRAFT = {
    camera_id: 1,
    nama_kamera: cameraName(1),
    aktif: true,
    label: cameraName(1),
    model: 'yolov8n_kendaraan_kabupaten_bojonegoro.pt',
    imgsz: 640, conf: 0.35, conf_gambar: 0.5, fps: 5, min_gerak: 12, min_umur: 3,
    /* A 2-component direction VECTOR, not a label: the page calls .toFixed() on both components,
     * so a string here renders the ErrorBoundary instead of the settings form. */
    arah_arus: [1, 0],
    nama_arah: { plus: 'Menuju Kota Bojonegoro Selatan Lewat Simpang', minus: 'Menuju Kecamatan Dander Lewat Jembatan' },
    /* `{a, b}` endpoints, not `{pt: [...]}`: the line editor indexes garis[0].a[0] directly and a
     * differently-shaped point list takes the whole page down with the ErrorBoundary. */
    garis: [
        { nama: 'Garis hitung arah utara menuju selatan lewat simpang', a: [0.1, 0.5], b: [0.9, 0.52] },
        { nama: 'Garis hitung arah barat menuju timur lewat jembatan', a: [0.15, 0.7], b: [0.85, 0.72] },
    ],
};

const VEHICLE_SUMMARY = {
    total: 18_432,
    total_10_menit: 412,
    total_jenis: { mobil: 9_120, motor: 8_001, truk: 1_311, bus: 421, sepeda: 679 },
    arah: {
        'Menuju Kota Bojonegoro Selatan Lewat Simpang': 9_800,
        'Menuju Kecamatan Dander Lewat Jembatan': 8_632,
    },
    diperbarui: '2026-08-22T07:41:03.000Z',
    mulai: '2026-08-22T00:00:00.000Z',
    fps: 4.8, frame_diproses: 1_284_000, frame_dijatuhkan_sumber: 812,
    jumlah_garis: 1, model: 'yolov8n_kendaraan_kabupaten_bojonegoro.pt',
    sambung_ulang: 2, setelan_dimuat_ulang: 4, umur_frame_terakhir_detik: 0.4,
};

const TG_ARCHIVE_OVERVIEW = {
    available: true,
    groups: Array.from({ length: 4 }, (_, i) => ({
        chatId: `-100234567890${i}`,
        title: `Arsip CCTV Kecamatan Bojonegoro Selatan Wilayah ${i + 1}`,
        canPost: true,
    })),
    areas: ADMIN_AREAS.slice(0, 6).map((a) => ({ id: a.id, name: a.name })),
    routes: Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        label: `Rute arsip ${cameraName(i + 1)}`,
        scope: ['camera', 'area', 'all'][i % 3],
        cameraId: i + 1,
        areaId: (i % 6) + 1,
        chatId: `-100234567890${i % 4}`,
        enabled: i % 4 !== 3,
    })),
    cameras: ADMIN_CAMERAS.slice(0, 30).map((c, i) => ({
        id: c.id,
        name: c.name,
        areaName: c.area_name,
        targets: i % 5 === 4 ? [] : [{
            chatId: `-100234567890${i % 4}`,
            label: `Arsip CCTV Kecamatan Bojonegoro Selatan Wilayah ${(i % 4) + 1}`,
            mode: i % 2 ? 'copy' : 'move',
            detail: 'rute per-kamera',
            missing: false,
        }],
    })),
};

const TG_ARCHIVE_ACTIVITY = {
    available: true,
    totals: [
        { status: 'uploaded', files: 128_400, bytes: 42_949_672_960 },
        { status: 'pending', files: 51, bytes: 1_073_741_824 },
        { status: 'failed', files: 7, bytes: 134_217_728 },
        { status: 'skipped', files: 312, bytes: 0 },
    ],
    recent: Array.from({ length: 20 }, (_, i) => ({
        segmentId: i + 1,
        cameraId: 1169 + i,
        filename: LONG_FILENAME.replace('0001', String(i + 1).padStart(4, '0')),
        fileSize: 104_857_600 + i,
        status: ['uploaded', 'pending', 'failed'][i % 3],
    })),
};

const TG_LIBRARY_SUMMARY = {
    total: 128_400,
    playable: 127_988,
    bytes: 42_949_672_960,
    cameras: ADMIN_CAMERAS.slice(0, 30).map((c) => ({ id: c.id, name: c.name, segments: 4_280 })),
};

/* This one route answers `{ data: [...], meta: { total } }` — rows at the top level, count beside
 * them — so it needs the __body escape hatch. Timestamps are `recordedAt`/`recordedUntil`: the
 * timeline drops any row it cannot parse a start time from, and a fixture using startedAt/endedAt
 * renders "Belum ada segmen" while looking perfectly plausible in the source. */
const TG_LIBRARY = {
    __body: {
        success: true,
        meta: { total: 128_400 },
        data: Array.from({ length: 25 }, (_, i) => {
            const start = new Date(Date.UTC(2026, 7, 22, 0, 10 * i, 0));
            const end = new Date(start.getTime() + 600_000);
            return {
                segmentId: i + 1,
                cameraId: 1169 + i,
                cameraName: cameraName(i + 1),
                areaName: AREA_NAMES[i % AREA_NAMES.length],
                filename: LONG_FILENAME.replace('0001', String(i + 1).padStart(4, '0')),
                fileSize: 104_857_600 + i,
                playable: i % 9 !== 8,
                recordedAt: start.toISOString(),
                recordedUntil: end.toISOString(),
                durationSeconds: 600,
            };
        }),
    },
};

/* Flat key/value settings, exactly as /api/settings returns them. The ad scripts are the realistic
 * worst case here: a single <textarea> value with no whitespace for hundreds of characters. */
const ADS_SETTINGS = {
    ads_enabled: '1', ads_provider: 'adsterra',
    ads_desktop_enabled: '1', ads_mobile_enabled: '1',
    ads_popup_slots_enabled: '1', ads_popup_preferred_slot: 'bottom',
    ads_hide_social_bar_on_popup: '1', ads_hide_floating_widgets_on_popup: '1',
    ads_popup_desktop_max_height: '250', ads_popup_mobile_max_height: '120',
    ads_playback_native_enabled: '1', ads_playback_native_desktop_enabled: '1', ads_playback_native_mobile_enabled: '1',
    ads_playback_native_script: '<script async="async" data-cfasync="false" src="//pl12345678.effectivegatecpm.example/9f2d1c4b7a6e5d3f0a1b2c3d4e5f6a7b/invoke.js"></script><div id="container-9f2d1c4b7a6e5d3f0a1b2c3d4e5f6a7b"></div>',
    ads_playback_popunder_enabled: '0', ads_playback_popunder_desktop_enabled: '0', ads_playback_popunder_mobile_enabled: '0',
    ads_playback_popunder_script: '<script type="text/javascript" src="//pl87654321.effectivegatecpm.example/1a/2b/3c/1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.js"></script>',
    ads_social_bar_enabled: '1',
    ads_social_bar_script: '<script type="text/javascript" src="//pl11223344.effectivegatecpm.example/aa/bb/cc/aabbccddeeff00112233445566778899.js"></script>',
    ads_footer_banner_enabled: '1',
    ads_footer_banner_script: '<script type="text/javascript">atOptions={"key":"aabbccddeeff00112233445566778899","format":"iframe","height":50,"width":320,"params":{}};</script>',
    ads_after_cameras_native_enabled: '1',
    ads_after_cameras_native_script: '<script async="async" data-cfasync="false" src="//pl99887766.effectivegatecpm.example/aabbccddeeff00112233445566778899/invoke.js"></script>',
};

const MAP_CENTER = { latitude: -7.1500, longitude: 111.8817, zoom: 13 };

/* The admin playback page's segment list. Without this the page renders "Belum ada rekaman" and
 * the whole right-hand column — the densest part of the layout — is never measured. */
const PLAYBACK_SEGMENTS = {
    playback_policy: { scope: 'admin_full', can_share: true, window_hours: null },
    coverage: {
        from: '2026-08-15T00:00:00.000Z',
        to: '2026-08-22T08:00:00.000Z',
        runs: [{ from: '2026-08-22T00:00:00.000Z', to: '2026-08-22T08:00:00.000Z' }],
    },
    segments: Array.from({ length: 25 }, (_, i) => {
        const start = new Date(Date.UTC(2026, 7, 22, 0, 10 * i, 0));
        return {
            id: i + 1,
            filename: LONG_FILENAME.replace('0001', String(i + 1).padStart(4, '0')),
            start_time: start.toISOString(),
            end_time: new Date(start.getTime() + 600_000).toISOString(),
            duration: 600,
            file_size: 104_857_600 + i,
            source: 'local',
        };
    }),
};

/* AreaCard reads far more than the affiliate fixture's areas carry, and every one of those extra
 * fields is a chip or a number rendered in the card's header row. */
const AREAS_OVERVIEW = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    name: AREA_NAMES[i % AREA_NAMES.length],
    slug: `area-${i + 1}`,
    kecamatan: 'KECAMATAN BOJONEGORO SELATAN DAN SEKITARNYA',
    kelurahan: 'KELURAHAN SUMBEREJO WETAN NOMOR SATU',
    rt: String((i % 12) + 1).padStart(2, '0'),
    rw: String((i % 6) + 1).padStart(2, '0'),
    latitude: -7.15 + i * 0.001,
    longitude: 111.88 + i * 0.001,
    camera_count: 12 + i,
    online: 8 + (i % 5),
    offline: 2 + (i % 3),
    degraded: i % 2,
    maintenance: i % 4 === 0 ? 1 : 0,
    passive: i % 3,
    internal: 9 + (i % 4),
    external: 3 + (i % 2),
    dominant: 'internal',
    coverage_scope: 'kecamatan',
    total_views: 5000 + i,
    description: 'Deskripsi area yang panjang supaya kartunya terisi seperti di produksi.',
    show_on_grid_default: 1,
    grid_default_camera_limit: 12,
    internal_ingest_policy_default: 'on_demand',
    internal_on_demand_close_after_seconds: 60,
    external_health_mode_override: null,
    viewport_zoom_override: null,
}));

/* Ordered: first regex that matches the pathname wins, so put the specific ones first.
 *
 * A fixture value is normally the `data` payload. Wrap it as `{ __body: {...} }` when the page
 * reads a key that sits BESIDE data rather than inside it — /api/feedback and /api/admin/security/logs
 * both put `pagination` at the top level of the response, and a fixture that nests it under `data`
 * leaves the pager reading `undefined`. */
const API_FIXTURES = [
    [/^\/api\/admin\/affiliate\/partners$/, AFFILIATE_PARTNERS],
    [/^\/api\/admin\/affiliate\/offers$/, AFFILIATE_OFFERS],
    [/^\/api\/settings\/landing-page$/, LANDING_SETTINGS],
    [/^\/api\/settings\/map-center$/, MAP_CENTER],
    [/^\/api\/cameras$/, ADMIN_CAMERAS],
    [/^\/api\/areas$/, ADMIN_AREAS],
    [/^\/api\/areas\/overview$/, AREAS_OVERVIEW],
    [/^\/api\/cameras\/active$/, ADMIN_CAMERAS.slice(0, 24)],

    [/^\/api\/admin\/stats\/today/, TODAY_STATS],
    [/^\/api\/admin\/stats$/, DASHBOARD_STATS],
    [/^\/api\/admin\/debug\/camera-health$/, HEALTH_DEBUG],
    [/^\/api\/admin\/security\/logs$/, { __body: { success: true, data: SECURITY_LOGS, pagination: { page: 1, limit: 50, total: 4321, totalPages: 87 } } }],
    [/^\/api\/admin\/security\/stats$/, {
        total_events: 4321,
        events_by_type: [
            { event_type: 'login_failed', count: 812 },
            { event_type: 'rate_limit_exceeded', count: 1904 },
            { event_type: 'csrf_validation_failed', count: 233 },
            { event_type: 'access_denied', count: 671 },
            { event_type: 'admin_action', count: 701 },
        ],
    }],
    [/^\/api\/users$/, ADMIN_USERS],
    [/^\/api\/feedback\/stats$/, { total: 143, unread: 12, read: 88, resolved: 43 }],
    [/^\/api\/feedback$/, { __body: { success: true, data: FEEDBACK_ITEMS, pagination: { page: 1, limit: 20, total: 143, totalPages: 8 } } }],

    [/^\/api\/admin\/analytics\/viewers\/history$/, HISTORY_PAGE],
    [/^\/api\/admin\/analytics\/viewers$/, VIEWER_ANALYTICS],
    [/^\/api\/admin\/analytics\/realtime$/, { activeSessions: ANALYTIC_SESSIONS.slice(0, 8), activeViewers: 97 }],
    [/^\/api\/playback-viewer\/history$/, HISTORY_PAGE],
    [/^\/api\/playback-viewer\/analytics$/, VIEWER_ANALYTICS],
    [/^\/api\/playback-viewer\/active$/, { activeSessions: ANALYTIC_SESSIONS.slice(0, 8), activeViewers: 12 }],

    [/^\/api\/admin\/playback-tokens\/audit$/, PLAYBACK_TOKEN_AUDIT],
    [/^\/api\/admin\/playback-tokens$/, PLAYBACK_TOKENS],
    [/^\/api\/admin\/playback-products$/, PLAYBACK_PRODUCTS],
    [/^\/api\/admin\/cameras\/reports$/, CAMERA_REPORTS],
    [/^\/api\/admin\/cameras\/reactions$/, CAMERA_REACTIONS],
    [/^\/api\/admin\/notification-diagnostics\/runs$/, NOTIF_RUNS],

    [/^\/api\/sponsor-packages$/, SPONSOR_PACKAGES],
    [/^\/api\/sponsors\/stats$/, SPONSOR_STATS],
    [/^\/api\/sponsors$/, SPONSORS],
    [/^\/api\/promo-banners$/, PROMO_BANNERS],

    [/^\/api\/recordings\/\d+\/segments$/, PLAYBACK_SEGMENTS],
    [/^\/api\/recordings\/overview$/, RECORDING_OVERVIEW],
    [/^\/api\/recordings\/restarts$/, RECORDING_RESTARTS],
    [/^\/api\/recordings\/assurance$/, RECORDING_ASSURANCE],
    [/^\/api\/admin\/recording-health$/, RECORDING_HEALTH],
    [/^\/api\/admin\/recording-capacity$/, RECORDING_CAPACITY],

    [/^\/api\/admin\/billing\/camera-ips$/, BILLING_CAMERA_IPS],
    [/^\/api\/admin\/billing\/customers$/, BILLING_CUSTOMERS],
    [/^\/api\/admin\/billing\/subscriptions$/, BILLING_SUBSCRIPTIONS],
    [/^\/api\/admin\/billing\/payments$/, BILLING_PAYMENTS],
    [/^\/api\/admin\/billing\/plans$/, BILLING_PLANS],
    [/^\/api\/admin\/billing\/registrations$/, BILLING_REGISTRATIONS],
    [/^\/api\/admin\/billing\/registration-settings$/, { open: true, require_approval: true, default_plan_key: BILLING_PLANS[0].key }],
    [/^\/api\/admin\/billing\/promos$/, []],

    [/^\/api\/admin\/voucher\/settings$/, VOUCHER_SETTINGS],
    [/^\/api\/admin\/voucher\/profiles$/, VOUCHER_PROFILES],
    [/^\/api\/admin\/voucher\/codes$/, VOUCHER_CODES],

    [/^\/api\/admin\/ronda\/available$/, RONDA_AVAILABLE],
    [/^\/api\/admin\/ronda\/cameras$/, RONDA_CAMERAS],
    [/^\/api\/admin\/vehicle-count\/available$/, VEHICLE_AVAILABLE],
    [/^\/api\/admin\/vehicle-count\/cameras\/\d+\/ringkasan$/, VEHICLE_SUMMARY],
    [/^\/api\/admin\/vehicle-count\/cameras\/\d+$/, VEHICLE_DRAFT],
    [/^\/api\/admin\/vehicle-count\/cameras$/, VEHICLE_CAMERAS],

    [/^\/api\/admin\/telegram-archive\/overview$/, TG_ARCHIVE_OVERVIEW],
    [/^\/api\/admin\/telegram-archive\/activity$/, TG_ARCHIVE_ACTIVITY],
    [/^\/api\/admin\/telegram-archive\/library\/summary$/, TG_LIBRARY_SUMMARY],
    [/^\/api\/admin\/telegram-archive\/library$/, TG_LIBRARY],

    [/^\/api\/settings$/, ADS_SETTINGS],
];

/*
 * HOW THE ADMIN SESSION IS FAKED
 * ------------------------------
 * There is no AuthContext in this app. ProtectedRoute asks authService, and authService answers
 * from ONE place: `localStorage.getItem('user')` for isAuthenticated(), and that same object's
 * `.role === 'admin'` for isAdmin() (src/services/authService.js). The real access token lives in
 * an HttpOnly cookie the frontend cannot read, and every /api/* call is mocked here anyway, so
 * seeding that single localStorage key is the whole of what "logged in as admin" means client-side.
 * addInitScript runs before app code on every navigation, so the key is present when
 * ProtectedRoute first evaluates — no login round-trip, no flash of the login page.
 */
const ADMIN_USER = {
    id: 1,
    username: 'e2e-admin',
    email: 'e2e-admin@example.invalid',
    role: 'admin',
    full_name: 'Operator Uji Otomatis Dengan Nama Panjang',
};

test.beforeEach(async ({ page, context }) => {
    await page.addInitScript((user) => {
        window.localStorage.setItem('user', JSON.stringify(user));
    }, ADMIN_USER);

    // Same contract as the public spec: known payloads for the endpoints these pages read, empty
    // success for everything else, and every non-local request blocked.
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
        if (!local) return route.abort();
        if (url.pathname.startsWith('/api/')) {
            const fixture = API_FIXTURES.find(([pattern]) => pattern.test(url.pathname));
            const value = fixture ? fixture[1] : [];
            const body = value && value.__body ? value.__body : { success: true, data: value };
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });
        }
        return route.continue();
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
});

/*
 * THE MEASUREMENT — and why documentElement is useless on these pages.
 *
 * Public pages let content reach the DOCUMENT's scrollable rect, so `documentElement.scrollWidth`
 * is the number that catches a runaway strip there. Admin pages have TWO layers that swallow it:
 *
 *   - `overflow-x: clip` on html AND body (src/index.css) clamps the root's scroll rect outright;
 *   - even without that, <main> is itself a scroll container (`overflow-y: auto` ⇒ overflow-x:auto),
 *     and a scroll container ABSORBS its content's overflow. Its own box stays viewport-width; the
 *     excess becomes ITS scrollWidth and never propagates to the document.
 *
 * That is why 80 root measurements said 320/320 while the layout was 689px wide. The honest number
 * for a page rendered inside AdminLayout is therefore the CONTAINER's own overflow:
 *
 *   (a) main.scrollWidth vs main.clientWidth — the container's content does not fit the container;
 *   (b) a sweep for any visible element whose rect.right passes the container's right edge, which
 *       names the culprit instead of just reporting a width.
 *
 * The sweep skips elements sitting inside a NESTED scroll container (the tab strip, the picker's
 * own max-h list): those are deliberately scrollable and being wide is their job. It stops that
 * ancestor walk AT <main>, which is exactly the line the public helper cannot draw — it walks to
 * documentElement, hits <main>, and discards the entire admin surface.
 *
 * position:fixed boxes escape every clip, so they are measured against the VIEWPORT instead — same
 * reasoning as the public spec's `fixed` number (that is how the FeedbackWidget bug shipped). On
 * these pages that covers the mobile admin header and the bottom dock.
 */
const measureAdminShell = () => {
    const de = document.documentElement;
    const main = document.querySelector('main');
    if (!main) return { found: false };

    const mainRect = main.getBoundingClientRect();
    const limit = mainRect.right;

    const describe = (el) => {
        const cls = (el.getAttribute('class') || '').slice(0, 90);
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        return `<${el.tagName.toLowerCase()} class="${cls}">${text ? ` — "${text}"` : ''}`;
    };

    // A nested scroll container between `el` and <main> is allowed to be wider than the viewport.
    const insideNestedScroller = (el) => {
        let p = el.parentElement;
        while (p && p !== main) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'clip') return true;
            p = p.parentElement;
        }
        return false;
    };

    let worst = null;
    let fixedRight = 0;
    let fixedWorst = null;

    for (const el of document.querySelectorAll('body *')) {
        const rect = el.getBoundingClientRect();
        if (!rect.width && !rect.height) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden') continue;

        if (cs.position === 'fixed') {
            if (rect.right > fixedRight) {
                fixedRight = rect.right;
                fixedWorst = describe(el);
            }
            continue;
        }

        if (!main.contains(el)) continue;
        if (insideNestedScroller(el)) continue;
        if (rect.right <= limit + 1) continue;
        if (!worst || rect.right > worst.right) worst = { right: Math.round(rect.right), what: describe(el) };
    }

    return {
        found: true,
        vw: de.clientWidth,
        mainScrollW: main.scrollWidth,
        mainClientW: main.clientWidth,
        worstRight: worst ? worst.right : 0,
        worstWhat: worst ? worst.what : null,
        limit: Math.round(limit),
        fixed: Math.round(fixedRight),
        fixedWhat: fixedWorst,
        // Reported purely so a failure message can show it sitting there looking innocent.
        rootScrollW: de.scrollWidth,
    };
};

/*
 * THE SECOND BLIND SPOT: A DIALOG IS OUT OF FLOW, SO <main> CANNOT SEE IT EITHER
 * ------------------------------------------------------------------------------
 * src/components/ui/Modal.jsx renders `fixed inset-0 …` and does NOT createPortal. A position:fixed
 * subtree is out of normal flow, so it contributes NOTHING to main.scrollWidth — and
 * measureAdminShell()'s sweep discards it twice over:
 *
 *   - the overlay is the only `fixed` box in the tree, so the fixed bucket records ONE
 *     full-viewport rect (inset-0) and, being exactly viewport-wide, it always passes;
 *   - everything inside the panel sits under `overflow-hidden` (the panel) or `overflow-y-auto`
 *     (its body), so insideNestedScroller() returns true and skips the entire dialog.
 *
 * Net effect: the instant an inline admin form becomes a Modal, its overflow test goes VACUOUS —
 * green no matter how wide the dialog content is. That is not hypothetical: it is exactly the trade
 * the modal-unification work makes on the pages that still render their form inline, and this
 * measurement is the price of making that trade safe. Coverage has to be MAINTAINED across the
 * conversion, not just kept green.
 *
 * WHAT IS MEASURED — HORIZONTAL ONLY. A dialog that scrolls VERTICALLY is working as designed
 * (max-h-[92dvh] + an overflow-y-auto body is the whole point), so nothing here looks at height.
 *
 *   (a) the dialog's scrollable BODY REGION: scrollWidth vs clientWidth. From Modal.jsx the panel
 *       is `flex flex-col overflow-hidden` over three children — header, body
 *       (`min-h-0 flex-1 overflow-y-auto`), optional footer — so the body is the one direct child
 *       that is a scroll container, and Tailwind's `overflow-y-auto` leaves overflow-x computing to
 *       `auto`: it absorbs its content's horizontal overflow exactly the way <main> does, which is
 *       why the body's OWN scrollWidth is the honest number. It is located by computed style rather
 *       than by class name, so this also measures the hand-rolled dialogs that put the scroller on
 *       the panel itself — there the panel is its own body region and (a) collapses into (b).
 *       AreaFormModal.jsx used to be the example here and is a ui/Modal since the 2026-08 dialog
 *       unification; what still takes that shape is the analytics session DRAWER
 *       (components/admin/analytics/AnalyticsHistoryTable.jsx, panel is `overflow-y-auto`), which
 *       is why the entry 'admin analytics (session drawer open, hand-rolled panel)' exists — the
 *       fallback branch needs a page proving it, or it is a claim rather than a measurement.
 *   (b) the PANEL: scrollWidth vs clientWidth. `overflow: hidden` still reports true content width,
 *       so this is what catches a header or a footer — neither of which scrolls — pushed wide by a
 *       long title or an action row that refuses to wrap.
 *   (c) a right-edge sweep naming the widest offender, same idiom and same skip rules as the shell
 *       sweep, because naming the element is what made the last round fixable in one pass.
 *
 * PROVEN ABLE TO FAIL — do not take this on faith, and re-prove it if you change the measurement.
 * The recipe is 30 seconds: in the `open` step of 'admin users (create form open)', append a
 * `<div style="width:900px">` to the dialog's body region, then run
 *   npx playwright test e2e/admin-overflow.spec.js -g "users \(create form open\) @393px"
 * Measured 2026-08-22, Pixel-5 profile at 393px:
 *   RED   → body region 932px wide, only 391px fits (948/391 at 1.5x font); offender named as
 *           `<div class="e2e-injected-overflow">` reaching 917px past a panel edge at 393px.
 *   GREEN → body region 391/391 with the injection removed.
 * The number that matters in that RED run: main.scrollWidth read 393/393 and rootScrollW 393, so
 * ALL FOUR pre-existing assertions in this file passed while the dialog was 2.4x too wide. Note
 * panelScrollW also stayed 391 — the panel's `overflow-hidden` body absorbed it — which is why (a)
 * is the load-bearing measurement and (b) alone would have been a decoration.
 *
 * RE-PROVEN the same day on the three forms that moved into ui/Modal (ronda add-camera,
 * hitung-kendaraan settings, telegram-archive route), because a conversion that keeps the suite
 * green while measuring nothing is exactly the trade this flag exists to prevent. Same injection
 * dropped into each `open` step: all three went RED at 932px of body against 391px that fits (948
 * at 1.5x font), each naming `<div class="e2e-injected-overflow">`, while main.scrollWidth still
 * read 393/393 — and the untouched voucher dialog stayed green in the same run.
 *
 * RE-PROVEN AGAIN on the four dialogs that moved into ui/Modal next — camera add/edit, camera
 * class, area create/edit, and the Bulk Policy Center that was inlined in AreaManagement.jsx — plus
 * the analytics session drawer, which is the one entry left in the `bodyIsPanel` shape. Same
 * injection, RED on all five: 932px of body against 391px that fits at 393px (948 at 1.5x font,
 * 318px that fits at 320px), each naming `<div class="e2e-injected-overflow">`, while
 * main.scrollWidth read 393/393 throughout. The drawer's numbers differ (948/392, 972/392 at 1.5x)
 * BECAUSE the fallback fired — panel and body region are one element there, which is what proves
 * that branch runs rather than merely existing.
 */
const measureAdminDialogs = () => {
    const isVisible = (el, rect) => {
        if (!rect.width && !rect.height) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none';
    };

    const panels = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((el) => isVisible(el, el.getBoundingClientRect()));
    if (!panels.length) return { found: false, panels: 0 };

    const describe = (el) => {
        const cls = (el.getAttribute('class') || '').slice(0, 90);
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        return `<${el.tagName.toLowerCase()} class="${cls}">${text ? ` — "${text}"` : ''}`;
    };

    const measureOne = (panel) => {
        const rect = panel.getBoundingClientRect();
        const limit = rect.right;

        /* Modal.jsx's body is the only DIRECT child that scrolls; a hand-rolled dialog may scroll on
         * the panel itself, in which case the panel is its own body region. */
        const body = Array.from(panel.children).find((c) => {
            const oy = getComputedStyle(c).overflowY;
            return oy === 'auto' || oy === 'scroll';
        }) || panel;

        /* Same rule as the shell sweep — a nested scroller INSIDE the dialog (the picker's own
         * max-h list, a table wrapper) is deliberately scrollable and being wide is its job. The
         * walk stops at the panel, and the body region is exempt: it is the container being
         * measured, so treating it as a nested scroller would re-create the exact blindness the
         * top of this file exists to document. */
        const insideNestedScroller = (el) => {
            let p = el.parentElement;
            while (p && p !== panel) {
                if (p !== body) {
                    const ox = getComputedStyle(p).overflowX;
                    if (ox === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'clip') return true;
                }
                p = p.parentElement;
            }
            return false;
        };

        let worst = null;
        for (const el of panel.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (!isVisible(el, r)) continue;
            // A fixed box escapes the panel's clip; the shell's fixed bucket already measures it
            // against the viewport, which is the only meaningful limit for it.
            if (getComputedStyle(el).position === 'fixed') continue;
            if (insideNestedScroller(el)) continue;
            if (r.right <= limit + 1) continue;
            if (!worst || r.right > worst.right) worst = { right: Math.round(r.right), what: describe(el) };
        }

        const heading = panel.querySelector('h1, h2, h3');
        return {
            title: ((heading && heading.textContent) || panel.getAttribute('aria-label') || '(untitled)').trim().slice(0, 60),
            panelScrollW: panel.scrollWidth,
            panelClientW: panel.clientWidth,
            bodyScrollW: body.scrollWidth,
            bodyClientW: body.clientWidth,
            // true = a hand-rolled dialog scrolling on the panel, so (a) and (b) are one number.
            bodyIsPanel: body === panel,
            panelRight: Math.round(rect.right),
            limit: Math.round(limit),
            worstRight: worst ? worst.right : 0,
            worstWhat: worst ? worst.what : null,
        };
    };

    const excess = (m) => Math.max(
        m.panelScrollW - m.panelClientW,
        m.bodyScrollW - m.bodyClientW,
        m.worstRight ? m.worstRight - m.limit : 0,
    );
    // With two dialogs on screen the interesting one is the broken one, not the topmost one.
    const worstPanel = panels.map(measureOne).reduce((a, b) => (excess(b) > excess(a) ? b : a));

    return { found: true, panels: panels.length, vw: document.documentElement.clientWidth, ...worstPanel };
};

/*
 * THE TWO NON-OVERFLOW DEFECTS THIS AUDIT ALSO RECORDS
 * ----------------------------------------------------
 * Both are the same family of bug as the overflow ones — content that is present in the DOM but
 * unreachable on a phone — and neither is visible to a code review:
 *
 *   (a) TAP TARGETS. A control smaller than 44px in either axis is hard to hit on a touch screen
 *       (WCAG 2.5.5 AAA; 2.5.8 AA sets the floor at 24px). `min(width, height)` is the honest
 *       measure: a 200x30 button fails on height even though it looks generous.
 *   (b) TRUNCATION WITH NO RECOVERY. `truncate` renders an ellipsis and silently discards the rest
 *       of the string. That is fine when the full value is recoverable — a `title` (or aria-label)
 *       gives it back on hover/long-press — and a data-loss bug when it is not. On admin pages the
 *       truncated thing is usually the camera name or the filename, i.e. the identifying field.
 *
 * These are REPORTED, not asserted: they are pre-existing and pervasive, and turning them into
 * failures now would bury the overflow signal this file exists to protect. The numbers land in the
 * run output as `AUDIT {...}` lines, one per page/viewport/font combination.
 */
const auditPageControls = () => {
    const main = document.querySelector('main');
    if (!main) return { smallTargets: [], truncatedNoTitle: [] };

    const describe = (el) => {
        const cls = (el.getAttribute('class') || '').slice(0, 60);
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        const name = el.getAttribute('aria-label') || text || el.getAttribute('placeholder') || '';
        return `<${el.tagName.toLowerCase()}${el.type ? ` type=${el.type}` : ''} class="${cls}">${name ? ` — "${name}"` : ''}`;
    };

    const visible = (el, rect) => {
        if (!rect.width || !rect.height) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };

    const smallTargets = [];
    const CONTROLS = 'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';
    for (const el of main.querySelectorAll(CONTROLS)) {
        const rect = el.getBoundingClientRect();
        if (!visible(el, rect)) continue;
        // A hidden checkbox behind a styled label is the normal toggle pattern, not a small target.
        if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio') && getComputedStyle(el).appearance === 'none' && rect.width < 4) continue;
        const min = Math.min(rect.width, rect.height);
        if (min < 44) smallTargets.push({ px: Math.round(min * 10) / 10, w: Math.round(rect.width), h: Math.round(rect.height), what: describe(el) });
    }

    const truncatedNoTitle = [];
    for (const el of main.querySelectorAll('*')) {
        const rect = el.getBoundingClientRect();
        if (!visible(el, rect)) continue;
        const cs = getComputedStyle(el);
        const clipsInline = cs.textOverflow === 'ellipsis' && (cs.overflowX === 'hidden' || cs.overflowX === 'clip');
        const clipsBlock = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
        if (!clipsInline && !clipsBlock) continue;
        const cut = clipsInline ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1;
        if (!cut) continue;
        if (el.title || el.getAttribute('aria-label')) continue;
        // A control's own accessible name comes from elsewhere; only flag content text.
        if (el.closest('[title]')) continue;
        truncatedNoTitle.push({
            lost: Math.max(el.scrollWidth - el.clientWidth, el.scrollHeight - el.clientHeight),
            text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70),
            what: `<${el.tagName.toLowerCase()} class="${(el.getAttribute('class') || '').slice(0, 60)}">`,
        });
    }

    smallTargets.sort((a, b) => a.px - b.px);
    truncatedNoTitle.sort((a, b) => b.lost - a.lost);
    return { smallTargets, truncatedNoTitle };
};

async function assertNoAdminOverflow(page, label, { expectDialog = false } = {}) {
    const m = await page.evaluate(measureAdminShell);
    expect(m.found, `${label}: no <main> — this page did not render inside AdminLayout, so nothing was measured`).toBe(true);

    const d = await page.evaluate(measureAdminDialogs);
    const audit = await page.evaluate(auditPageControls);
    // One machine-readable line per measurement: this is the audit's actual output.
    console.log(`AUDIT ${JSON.stringify({
        label,
        vw: m.vw,
        mainScrollW: m.mainScrollW,
        mainClientW: m.mainClientW,
        overflowPx: Math.max(0, m.mainScrollW - m.mainClientW),
        worstRight: m.worstRight,
        limit: m.limit,
        worstWhat: m.worstWhat,
        fixed: m.fixed,
        fixedWhat: m.fixed > m.vw + 1 ? m.fixedWhat : null,
        rootScrollW: m.rootScrollW,
        smallTargets: audit.smallTargets.length,
        smallTargetSamples: audit.smallTargets.slice(0, 6),
        truncatedNoTitle: audit.truncatedNoTitle.length,
        truncatedSamples: audit.truncatedNoTitle.slice(0, 6),
        // null on every page with no dialog on screen — the shape those lines had before dialogs
        // were measured at all, so the audit output stays diffable across the modal conversion.
        dialog: d.found ? {
            panels: d.panels,
            title: d.title,
            panelScrollW: d.panelScrollW,
            panelClientW: d.panelClientW,
            bodyScrollW: d.bodyScrollW,
            bodyClientW: d.bodyClientW,
            bodyIsPanel: d.bodyIsPanel,
            overflowPx: Math.max(0, d.bodyScrollW - d.bodyClientW, d.panelScrollW - d.panelClientW),
            worstRight: d.worstRight,
            limit: d.limit,
            worstWhat: d.worstWhat,
        } : null,
    })}`);

    /*
     * SOFT, on purpose. A page is measured four times (two widths x two font scales) and the audit
     * needs all four numbers; a hard expect aborts the test at the first one and hides the rest —
     * which matters here because every defect the first run found existed ONLY at 1.5x font, i.e.
     * strictly after a failure at normal font would have stopped the test. Soft expects still fail
     * the test at the end, so CI keeps the same verdict it had before.
     */
    expect.soft(
        m.mainScrollW,
        `${label}: the admin scroll container is ${m.mainScrollW}px wide but only ${m.mainClientW}px fits `
        + `(viewport ${m.vw}px). The page scrolls sideways. documentElement.scrollWidth says `
        + `${m.rootScrollW} — that number is blind here, see the header of this file. `
        + `Widest offender: ${m.worstWhat || '(none found — look for a nested scroller that should not scroll)'}`
        + ` at ${m.worstRight}px. Usual cause: a <fieldset> or flex/grid child without min-w-0, or an `
        + 'unbreakable token without break-all.',
    ).toBeLessThanOrEqual(m.mainClientW + 1);

    expect.soft(
        m.worstRight,
        `${label}: an element reaches ${m.worstRight}px, past the container's right edge at ${m.limit}px `
        + `(viewport ${m.vw}px) — ${m.worstWhat}`,
    ).toBeLessThanOrEqual(m.limit + 1);

    expect.soft(
        m.fixed,
        `${label}: a position:fixed element reaches ${m.fixed}px on a ${m.vw}px viewport — ${m.fixedWhat}`,
    ).toBeLessThanOrEqual(m.vw + 1);

    /*
     * ANTI-VACUITY GATE for the dialog measurement. Hard, not soft, and deliberately so: a page
     * flagged `dialog: true` whose modal did not open measured NOTHING new, and letting that run to
     * the end would print four green dialog assertions taken on an empty result — the precise
     * failure mode this measurement was added to prevent. Same class as the `m.found` check above.
     */
    if (expectDialog) {
        expect(
            d.found,
            `${label}: expected a ui/Modal on screen (this page's spec sets dialog: true) but no visible `
            + '[role="dialog"] was found, so the dialog measurement was VACUOUS. Either the `open` step '
            + 'no longer opens the form, or the form stopped being a dialog — do not "fix" this by '
            + 'dropping the flag.',
        ).toBe(true);
    }

    // Pages with no dialog on screen behave EXACTLY as before this measurement existed.
    if (!d.found) return m;

    expect.soft(
        d.bodyScrollW,
        `${label}: the dialog "${d.title}" scrolls SIDEWAYS — its body region is ${d.bodyScrollW}px wide `
        + `but only ${d.bodyClientW}px fits (viewport ${d.vw}px, panel ${d.panelClientW}px). `
        + `main.scrollWidth says ${m.mainScrollW}/${m.mainClientW} — that number is blind to a dialog, `
        + 'which is `fixed inset-0` and therefore out of flow (see the dialog note above measureAdminDialogs). '
        + `Widest offender: ${d.worstWhat || '(none past the panel edge — look for a nested scroller inside the dialog that should not scroll)'}`
        + ` at ${d.worstRight}px. Usual cause: a flex/grid child or <fieldset> without min-w-0, an `
        + 'unbreakable token without break-all, or a fixed-width control in a form column.',
    ).toBeLessThanOrEqual(d.bodyClientW + 1);

    /* Only meaningful when the panel and the body region are different boxes. On a hand-rolled
     * dialog that scrolls on the panel itself they are the same number, and asserting it twice would
     * print a second, contradictory message ("the body is not the culprit") for one defect. */
    if (!d.bodyIsPanel) {
        expect.soft(
            d.panelScrollW,
            `${label}: the dialog "${d.title}" PANEL is ${d.panelScrollW}px wide but only ${d.panelClientW}px `
            + 'fits. The body region is not the culprit here — the header and the footer do not scroll, so '
            + 'this is a long title, a description, or an action row that will not wrap. '
            + `Widest offender: ${d.worstWhat || '(none past the panel edge)'} at ${d.worstRight}px.`,
        ).toBeLessThanOrEqual(d.panelClientW + 1);
    }

    expect.soft(
        d.worstRight,
        `${label}: inside the dialog "${d.title}", an element reaches ${d.worstRight}px, past the panel's `
        + `right edge at ${d.limit}px (viewport ${d.vw}px) — ${d.worstWhat}`,
    ).toBeLessThanOrEqual(d.limit + 1);

    expect.soft(
        d.panelRight,
        `${label}: the dialog "${d.title}" itself reaches ${d.panelRight}px on a ${d.vw}px viewport — the `
        + 'panel is wider than the screen, so part of the dialog is unreachable.',
    ).toBeLessThanOrEqual(d.vw + 1);

    return m;
}

/*
 * Matching by text on these pages needs the `visible=true` filter, always. Every admin page that
 * targets cameras renders the 750-camera list into a <select>, so a bare `text=<camera name>` hits
 * an <option> first — and an <option> in a closed select is never visible, so the wait times out on
 * a page that rendered perfectly. Anti-vacuity is unaffected: it still demands a RENDERED element
 * carrying fixture text.
 */
const shown = (page, selector) => page.locator(`${selector} >> visible=true`).first();

/*
 * `ready` is the anti-vacuity gate, one per page: a selector that only exists once the page has
 * actually rendered its heavy content. Without it a run that silently fell back to the login page,
 * or rendered a spinner, would measure an empty box and pass.
 *
 * `open` drives the page into the state the audit measured. The affiliate defects only appear with
 * the offer editor open on a camera-targeted row — the picker is not reachable from a URL, so the
 * test clicks its way there and then asserts the picker is on screen before measuring.
 *
 * `dialog: true` says the state `open` reaches is a DIALOG, and turns the dialog measurement from
 * best-effort into a requirement: no visible [role="dialog"] then fails the test outright. Set it
 * on every entry whose `open` ends with a ui/Modal on screen — including when an inline form is
 * converted to one, which is the whole point. Without the flag a conversion silently trades a real
 * <main> measurement for a dialog nobody measures, and the suite stays green through it.
 */
const ADMIN_PAGES = [
    {
        name: 'admin affiliate (offer editor, 750-camera picker open)',
        url: '/admin/affiliate',
        ready: 'text=Toko Rekanan',
        /* ui/Modal since the 2026-08 form conversion (AffiliateManagement.jsx). The editor used to
         * be an inline <Card>, which <main> measured directly; now it is `fixed inset-0` and <main>
         * cannot see one pixel of it. Without this flag the two defects this entry was WRITTEN for
         * — the 689px <fieldset> and the off-screen search box, both inside the picker below —
         * would have become unmeasurable on the same day the form moved. */
        dialog: true,
        open: async (page) => {
            await page.getByRole('tab', { name: /Barang/ }).click();
            await page.getByRole('button', { name: 'Ubah' }).first().click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
            // The picker itself — the widest thing on the page and the thing both defects lived in.
            await expect(
                page.getByLabel('Cari Kamera'),
                'the camera picker never rendered, so this run measured nothing',
            ).toBeVisible();
            await expect(page.getByText(/Menampilkan 200 dari 750/)).toBeVisible();
        },
    },
    {
        /* The list BEHIND the dialog. The entry above still measures <main>, but only ever with the
         * editor open — and an 85-char store name plus a 120-char unbreakable product URL are a
         * list-row problem, not a dialog one. Measuring the closed state too keeps the rows covered
         * now that the form no longer sits among them. */
        name: 'admin affiliate (partner + offer lists, no editor)',
        url: '/admin/affiliate',
        ready: 'text=TOKO KAMERA PENGAWAS DAN AKSESORIS JARINGAN SERBA ADA CABANG BOJONEGORO PUSAT SATU',
        open: async (page) => {
            await page.getByRole('tab', { name: /Barang/ }).click();
            await expect(shown(page, 'text=/KAMERA IP OUTDOOR 3MP ANTI AIR/')).toBeVisible();
        },
    },
    {
        name: 'admin cameras (list, 750 rows)',
        url: '/admin/cameras',
        ready: `text=${cameraName(1)}`,
    },
    {
        /* The add/edit camera form: the densest dialog in admin after the affiliate editor — four
         * field sections, a delivery-type picker and an embedded map. It was ALWAYS `fixed
         * inset-0`, so <main> never saw it and no entry here measured it; converting it to ui/Modal
         * (CameraFormModal.jsx) is what finally makes it reachable, and this entry is that gain. */
        name: 'admin cameras (add-camera form open, ui/Modal)',
        url: '/admin/cameras',
        ready: `text=${cameraName(1)}`,
        dialog: true,
        open: async (page) => {
            await page.getByRole('button', { name: 'Tambah Kamera' }).first().click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
            /* Keyed INSIDE the panel: proves the field sections rendered, not just the shell.
             * By id, not by label — the list behind the dialog has its own "Filter area" <select>,
             * so getByLabel('Area') is ambiguous on this page. */
            await expect(page.locator('#camera-area')).toBeVisible();
        },
    },
    {
        /* The visibility/class dialog on a camera row — short, but it carries the two longest
         * warning paragraphs in admin plus an owner <select> whose options are user rows. Same
         * story as the entry above: `fixed inset-0` from birth, measured by nothing until it
         * became a ui/Modal. */
        name: 'admin cameras (class dialog open, ui/Modal)',
        url: '/admin/cameras',
        ready: `text=${cameraName(1)}`,
        dialog: true,
        open: async (page) => {
            await page.getByTitle('Ubah kelas kamera (publik / privat)').first().click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
            /* Owner Private is the branch that adds the widest thing in the dialog: an owner
             * <select> whose options are the 24-row /api/users fixture, LONG_USERNAME included.
             * (The retroactive-history warning is NOT reachable here — it needs a camera that is
             * ALREADY owner_private, and every fixture camera is community.) */
            await page.getByRole('radio', { name: /Owner Private/i }).click();
            await expect(page.getByLabel('Pemilik kamera')).toBeVisible();
        },
    },
    {
        name: 'admin settings (dense form)',
        url: '/admin/settings',
        ready: '#landing_area_coverage',
    },

    /* ---- the rest of the admin surface, added in the 2026-08 coverage extension ----
     *
     * Every `ready` below is keyed to a value that comes from a FIXTURE, never to a heading or a
     * button that renders regardless. That is the difference between "the page loaded" and "the
     * page loaded with rows in it", and only the second one can overflow. Where a page's real
     * density lives behind a button (a create/edit modal), `open` clicks through to it — the
     * affiliate case is the precedent: both original defects were invisible until the editor and
     * its camera picker were on screen. */
    {
        name: 'admin dashboard (24 live streams + 30 sessions)',
        url: '/admin/dashboard',
        /* The stream panel sorts by viewers and shows the top 8, so camera 0001 need not be among
         * them — match the shared name prefix instead of a specific row. */
        ready: 'text=SIMPANG EMPAT JALAN RAYA NAMA KAMERA YANG SENGAJA SANGAT PANJANG SEKALI',
    },
    {
        name: 'admin health-debug (25-row diagnostics table, unbreakable RTSP/HLS targets)',
        url: '/admin/health-debug',
        ready: `text=${cameraName(1)}`,
    },
    {
        name: 'admin security (50 log rows, full IPv6 + mobile UA)',
        url: '/admin/security',
        ready: `text=${LONG_IPV6}`,
    },
    {
        name: 'admin import-export (workflow form)',
        url: '/admin/import-export',
        ready: '#import-profile-select',
    },
    {
        name: 'admin backup-restore (upload + scope form)',
        url: '/admin/backup-restore',
        ready: 'text=2. Scope & Matching',
    },
    {
        name: 'admin areas (40 area cards)',
        url: '/admin/areas',
        ready: 'text=KELURAHAN SUMBEREJO WETAN NOMOR SATU',
    },
    {
        name: 'admin areas (create form open)',
        url: '/admin/areas',
        ready: 'text=KELURAHAN SUMBEREJO WETAN NOMOR SATU',
        /* ui/Modal since the 2026-08 dialog unification (AreaFormModal.jsx). It used to hand-roll
         * its own panel and scroll on it, which is the `bodyIsPanel` shape — that branch is now
         * proven by the analytics drawer entry below instead. Either way the flag stays: this is a
         * 14-field form with a map picker, and <main> cannot see one pixel of it. */
        dialog: true,
        open: async (page) => {
            await page.getByRole('button', { name: /Tambah Area/ }).first().click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
            // Keyed INSIDE the panel: proves the form body rendered, not just the dialog shell.
            await expect(shown(page, 'text=Default Health Monitoring External')).toBeVisible();
        },
    },
    {
        /* The Bulk Policy Center — 9 selects and a preview column in a two-column grid, i.e. the
         * densest dialog on this page. It was inlined in pages/AreaManagement.jsx and hand-rolled
         * its own chrome; it is a ui/Modal now, so this entry is what keeps it measured at all. */
        name: 'admin areas (bulk policy center open, ui/Modal)',
        url: '/admin/areas',
        ready: 'text=KELURAHAN SUMBEREJO WETAN NOMOR SATU',
        dialog: true,
        open: async (page) => {
            await page.getByTitle('Pengaturan Massal Kamera').first().click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
            await expect(page.getByLabel('Health Monitoring')).toBeVisible();
        },
    },
    {
        name: 'admin users (24 rows)',
        url: '/admin/users',
        ready: `text=${LONG_USERNAME}`,
    },
    {
        name: 'admin users (create form open)',
        url: '/admin/users',
        ready: `text=${LONG_USERNAME}`,
        // ui/Modal (UserManagement.jsx:524) — the reference call site the dialog measurement was
        // written against, and the one the RED/GREEN proof in the header was taken on.
        dialog: true,
        open: async (page) => {
            await page.getByRole('button', { name: /Tambah Pengguna/ }).first().click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
        },
    },
    {
        name: 'admin feedback (20 messages + detail panel)',
        url: '/admin/feedback',
        ready: 'text=Pengunjung Dengan Nama Yang Panjang Sekali Nomor 1',
    },
    {
        name: 'admin analytics (charts + 25-row session history)',
        url: '/admin/analytics',
        /* Keyed to the session table, not the camera name: the name also fills a <select>, and an
         * <option> is never "visible", so a camera-name ready selector waits forever on a page that
         * actually rendered fine. */
        ready: `text=${LONG_IPV6}`,
    },
    {
        /* THE ENTRY THAT PROVES THE `bodyIsPanel` FALLBACK, inherited from 'admin areas (create
         * form open)' when that one became a ui/Modal. AnalyticsHistoryDrawer
         * (components/admin/analytics/AnalyticsHistoryTable.jsx:25) is still hand-rolled and puts
         * `overflow-y-auto` on the PANEL, so measureAdminDialogs finds no scrolling direct child
         * and falls back to the panel itself. Without a page in this shape that branch is a claim,
         * not a measurement. It is also a genuinely dense dialog: a full IPv6, a mobile UA string
         * and a 70-char camera name in a max-w-lg side sheet. */
        name: 'admin analytics (session drawer open, hand-rolled panel)',
        url: '/admin/analytics',
        ready: `text=${LONG_IPV6}`,
        dialog: true,
        open: async (page) => {
            await shown(page, `text=${LONG_IPV6}`).click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
        },
    },
    {
        name: 'admin playback-analytics (charts + 25-row session history)',
        url: '/admin/playback-analytics',
        ready: `text=${LONG_IPV6}`,
    },
    {
        name: 'admin playback-tokens (12 tokens + 50 audit rows + issue form)',
        url: '/admin/playback-tokens',
        ready: 'text=Token Keluarga Bapak',
    },
    {
        name: 'admin playback-products (5 package cards, each an inline form)',
        url: '/admin/playback-products',
        ready: 'text=Coba Gratis 1 Hari Untuk Pengunjung Baru',
    },
    {
        /* The add-package dialog has ALWAYS been a ui/Modal, so the entry above — which measures
         * <main> — never saw a pixel of it. It earns its own entry now because its action row moved
         * out of the form body into ui/Modal's `footer`, and the footer is the one part of a dialog
         * the body measurement CANNOT see: it sits outside the scroll container, so a wide button
         * row there widens the panel and only the panel assertion reports it.
         *
         * PROVEN to bite, and the proof carries a caveat worth keeping. Appending a 3466px nowrap
         * <div> to the footer: with the footer's own `justify-end` the element lands at left −3090,
         * right 376 — 3090px of it clipped off the LEFT edge, unreachable — and every assertion
         * stays green, because scrollWidth only counts overflow past the inline-END edge and the
         * right-edge sweep sees a right edge inside the panel. Flip the same footer to
         * justify-start and it fails loudly at both widths and both font scales: panelScrollW 3482
         * vs clientW 391, offender named. So this entry does measure the footer — but a
         * justify-end row that overflows leftwards is invisible to a scrollWidth-based guard
         * ANYWHERE (the inline action row this replaced had the same shape and the same blind
         * spot), and closing it needs a left-edge check, not another entry. */
        name: 'admin playback-products (create form open, ui/Modal)',
        url: '/admin/playback-products',
        ready: 'text=Coba Gratis 1 Hari Untuk Pengunjung Baru',
        dialog: true,
        open: async (page) => {
            await page.getByRole('button', { name: 'Tambah paket' }).first().click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
            // Keyed INSIDE the panel: the last field of the body proves the form rendered, not just
            // the shell — and the submit button proves the pinned footer came with it.
            await expect(page.getByLabel('Masa berlaku (hari)')).toBeVisible();
            await expect(page.getByRole('button', { name: 'Buat paket' })).toBeVisible();
        },
    },
    {
        name: 'admin camera-reports (25 reports + filters)',
        url: '/admin/camera-reports',
        ready: 'text=Arah kamera bergeser dari semestinya',
    },
    {
        name: 'admin camera-reactions (60 rated cameras)',
        url: '/admin/camera-reactions',
        ready: `text=${cameraName(1)}`,
    },
    {
        name: 'admin notification-diagnostics (750-camera picker + 20 runs)',
        url: '/admin/notification-diagnostics',
        ready: 'text=camera_area_tidak_termasuk_dalam_lingkup_peringatan_telegram',
    },
    {
        name: 'admin sponsors (12 sponsors + 4 packages + assignment picker)',
        url: '/admin/sponsors',
        ready: 'text=CV SUMBER REJEKI ELEKTRONIK DAN PERKAKAS TEKNIK MANDIRI SEJAHTERA 1',
    },
    {
        name: 'admin sponsors (create form open)',
        url: '/admin/sponsors',
        ready: 'text=CV SUMBER REJEKI ELEKTRONIK DAN PERKAKAS TEKNIK MANDIRI SEJAHTERA 1',
        // ui/Modal (SponsorManagement.jsx:598) — a form dialog carrying a camera-assignment list.
        dialog: true,
        open: async (page) => {
            await page.getByRole('button', { name: /Tambah Sponsor/ }).first().click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
        },
    },
    {
        name: 'admin promo-banners (8 promos)',
        url: '/admin/promo-banners',
        ready: 'text=PROMO PEMASANGAN CCTV RUMAH DAN TOKO GRATIS SURVEI WILAYAH 1',
    },
    {
        name: 'admin promo-banners (create form open, 750-camera picker)',
        url: '/admin/promo-banners',
        ready: 'text=PROMO PEMASANGAN CCTV RUMAH DAN TOKO GRATIS SURVEI WILAYAH 1',
        /* The note that used to sit here said: when this form moves into ui/Modal, add `dialog:
         * true` in the SAME change, or the conversion silently swaps a real measurement for none at
         * all. That move happened (PromoBannerManagement.jsx), so here is the flag.
         *
         * The `open` step also had to grow. It only clicked "Tambah promo", which left the form on
         * its default target_mode of 'all' — the 750-camera picker this entry is NAMED after never
         * rendered, so the widest thing on the page was never on screen. Selecting "Kamera
         * tertentu" is what makes the name true. */
        dialog: true,
        open: async (page) => {
            await page.getByRole('button', { name: /Tambah promo/i }).first().click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
            await page.getByRole('radio', { name: /Kamera tertentu/ }).click();
            await expect(
                page.getByLabel('Cari Kamera'),
                'the camera picker never rendered, so this run measured a 3-radio form',
            ).toBeVisible();
            await expect(page.getByText(/Menampilkan 200 dari 750/)).toBeVisible();
        },
    },
    {
        name: 'admin ads (script textareas, long unbreakable ad tags)',
        url: '/admin/ads',
        ready: '#ads_playback_native_script',
    },
    {
        name: 'admin recordings (30 camera cards + capacity + health + restart log)',
        url: '/admin/recordings',
        ready: `text=${cameraName(1)}`,
    },
    {
        name: 'admin billing (18 customers — default tab, wallet forms + table)',
        url: '/admin/billing',
        ready: `text=${LONG_USERNAME}`,
    },
    {
        name: 'admin billing (18 subscriptions tab)',
        url: '/admin/billing',
        ready: `text=${LONG_USERNAME}`,
        open: async (page) => {
            await page.getByRole('button', { name: /^Langganan/ }).first().click();
            await expect(shown(page, `text=${cameraName(1)}`)).toBeVisible();
        },
    },
    {
        name: 'admin billing (8 pending registrations tab)',
        url: '/admin/billing',
        ready: `text=${LONG_USERNAME}`,
        open: async (page) => {
            await page.getByRole('button', { name: /^Persetujuan/ }).first().click();
            await expect(shown(page, 'text=calon_pelanggan_wilayah_01')).toBeVisible();
        },
    },
    {
        name: 'admin voucher (6 profiles + 40 codes)',
        url: '/admin/voucher',
        ready: 'text=RAFCCTV-0001-XKQP-9F2D',
    },
    {
        /* Dialog coverage from day one. This page ALREADY renders its form through ui/Modal
         * (VoucherManagement.jsx:467, size="lg"), so the dialog measurement is exercised by the
         * suite now rather than only once the inline forms are converted. It earned its place on
         * the first run: an lg dialog holding a 5-field number grid and a <fieldset> of 40 area
         * rows at 320px/1.5x font is the entry that surfaced the VoucherManagement defect recorded
         * at the top of this file. */
        name: 'admin voucher (profile form open, ui/Modal)',
        url: '/admin/voucher',
        ready: 'text=RAFCCTV-0001-XKQP-9F2D',
        dialog: true,
        open: async (page) => {
            await page.getByRole('button', { name: /Tambah Profil/ }).first().click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
            // Keyed to a control INSIDE the panel: proves the form body rendered, not just the shell.
            await expect(shown(page, 'text=Area yang dibuka')).toBeVisible();
        },
    },
    {
        name: 'admin ronda (6 camera config panels)',
        url: '/admin/ronda',
        ready: `text=${cameraName(1)}`,
    },
    {
        /* The add-camera form moved into ui/Modal, so <main> can no longer see it — this entry is
         * the replacement measurement, not an extra. It carries the 40-camera picker, whose option
         * labels are the longest strings on the page. */
        name: 'admin ronda (add-camera form open, ui/Modal)',
        url: '/admin/ronda',
        ready: `text=${cameraName(1)}`,
        dialog: true,
        open: async (page) => {
            await page.getByRole('button', { name: /Tambah Kamera/ }).first().click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
            // Keyed INSIDE the panel: proves the form body rendered, not just the dialog shell.
            await expect(shown(page, 'text=Nama area (untuk pesan)')).toBeVisible();
        },
    },
    {
        /* The counting SETTINGS form is a dialog now; what stays in <main> is the camera list plus
         * the live counter panel of the auto-selected camera (still dense: a 5-tile grid, a
         * per-direction list and the operational one-liner). The form itself is measured by the
         * entry below. */
        name: 'admin hitung-kendaraan (6 cameras + live counters)',
        url: '/admin/hitung-kendaraan',
        ready: `text=${cameraName(1)}`,
    },
    {
        /* Where the line editor, the 4 direction presets and the 8-field settings grid live now.
         * The page auto-SELECTS the first camera but deliberately does not auto-open this dialog,
         * so the click is required. */
        name: 'admin hitung-kendaraan (settings form open, ui/Modal)',
        url: '/admin/hitung-kendaraan',
        ready: `text=${cameraName(1)}`,
        dialog: true,
        open: async (page) => {
            await page.getByRole('button', { name: 'Ubah setelan' }).first().click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
            await expect(shown(page, 'text=Nyalakan penghitungan')).toBeVisible();
        },
    },
    {
        name: 'admin telegram-archive (8 routes + 30-camera routing table + activity)',
        url: '/admin/telegram-archive',
        ready: 'text=Rute arsip',
    },
    {
        /* RouteForm used to render unconditionally, i.e. <main> measured it on every run of the
         * entry above. It is a dialog now, so this entry inherits that coverage — including the
         * group <select> whose option labels are 50+ characters. */
        name: 'admin telegram-archive (route form open, ui/Modal)',
        url: '/admin/telegram-archive',
        ready: 'text=Rute arsip',
        dialog: true,
        open: async (page) => {
            await page.getByRole('button', { name: '+ Tambah rute' }).first().click();
            await expect(page.getByRole('dialog').first()).toBeVisible();
            await expect(shown(page, 'text=Grup Telegram')).toBeVisible();
        },
    },
    {
        name: 'admin arsip (25 segments in a day timeline)',
        url: '/admin/arsip',
        ready: `text=${cameraName(1)}`,
    },
    {
        name: 'admin customer-ips (42 routing endpoints)',
        url: '/admin/customer-ips',
        ready: `text=${cameraName(1)}`,
    },
    {
        name: 'admin playback (admin_full scope, 600-camera picker, 25 segments)',
        url: '/admin/playback',
        /* Camera 1 is one of the 20% with enable_recording: 0, so the playback picker drops it —
         * match camera 2, which the picker does carry. */
        ready: `text=${cameraName(2)}`,
    },
];

/* The public spec's width (Pixel 5, from playwright.config.js) plus 320 — the narrowest phone still
 * in the field, and the width both audit defects were worst at. */
const VIEWPORTS = [
    { label: '393px', width: 393, height: 851 },
    { label: '320px', width: 320, height: 640 },
];

for (const spec of ADMIN_PAGES) {
    for (const vp of VIEWPORTS) {
        test(`no horizontal overflow: ${spec.name} @${vp.label}`, async ({ page }) => {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.goto(spec.url, { waitUntil: 'networkidle' });

            /* DUMP_TEXT=1 prints what the page actually rendered. Adding a page here almost always
             * fails the `ready` gate once first — a fixture key is wrong, or the only match is an
             * <option> — and this is how you tell those two apart in one run instead of guessing. */
            if (process.env.DUMP_TEXT) {
                console.log(`TEXT[${spec.url}] ` + await page.evaluate(() => (document.querySelector('main')?.innerText || '').replace(/\s+/g, ' ').slice(0, 900)));
            }
            // Anti-vacuity: prove we are on the real page, not the login redirect or a spinner.
            await expect(
                shown(page, spec.ready),
                `${spec.name}: did not render (auth stub broken, or fixtures rejected) — nothing was measured`,
            ).toBeVisible({ timeout: 15_000 });

            if (spec.open) await spec.open(page);
            // Let lazy admin chunks and deferred mounts settle.
            await page.waitForTimeout(600);

            const opts = { expectDialog: !!spec.dialog };
            await assertNoAdminOverflow(page, `${spec.name} @${vp.label}`, opts);

            // Android "large text" (~1.5x) — the setting that turned a merely-tight admin row into
            // an off-screen one before the toggles got min-w-0 + truncate.
            await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
            await page.waitForTimeout(300);
            await assertNoAdminOverflow(page, `${spec.name} @${vp.label} @1.5x font`, opts);
        });
    }
}
