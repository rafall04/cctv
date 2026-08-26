/*
 * Purpose: Kunci perilaku watchdog gambar-hidup, terutama jalur SESUDAH vonis yang sebelumnya
 *          tidak punya tes sama sekali.
 * Caller: Vitest.
 * Deps: fake timers; elemen video tiruan.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Watchdog ini dipasang ke VideoPopup (pemutar utama publik) pada 2026-08-25. Sebelum itu ia
 * hanya menjaga ubin Multi-View. Cakupannya melompat dari satu ubin ke SETIAP penonton popup,
 * termasuk 182 kamera publik ber-origin pihak ketiga yang laju bingkainya di luar kendali kita.
 *
 * Jalur SEBELUM vonis sudah murah hati dan komentarnya sendiri menjelaskan alasannya: "Firing
 * early would turn a slow stream into a false 'unsupported' verdict." Jalur SESUDAH vonis dulu
 * melakukan persis kebalikannya — satu tick 500 ms tanpa bingkai baru langsung memvonis, jadi
 * sumber apa pun di bawah ~4 fps divonis "Codec tidak didukung browser" padahal gambarnya jalan.
 *
 * Proyek ini sudah pernah kena bentuk cacat yang sama (9785048: predikat codec yang menjawab
 * destroy() dan mematikan stream sehat), jadi kedua sisinya dikunci di sini: yang lambat harus
 * SELAMAT, yang mati harus tetap TERTANGKAP.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { hasPicture, startLivePictureWatch } from './livePictureWatch.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Video tiruan yang bisa digerakkan waktu dan bingkainya secara terpisah. */
function videoTiruan({ width = 1280, height = 720 } = {}) {
    return {
        readyState: 4,
        paused: false,
        currentTime: 0,
        videoWidth: width,
        videoHeight: height,
        buffered: { length: 1 },
        _frames: 0,
        getVideoPlaybackQuality() {
            return { totalVideoFrames: this._frames };
        },
    };
}

/** Majukan n tick 500 ms, memanggil `perTick(i)` sebelum masing-masing. */
function majukan(n, perTick) {
    for (let i = 0; i < n; i += 1) {
        perTick?.(i);
        vi.advanceTimersByTime(500);
    }
}

/*
 * Tick 500 ms yang cukup untuk MELEWATI tenggat macet pasca-vonis (stalledGiveUpMs).
 *
 * Dulu 12 (6 detik) saat tenggatnya 3 detik. Tenggat itu dinaikkan ke 10 detik pada 2026-08-26
 * karena 3 detik lebih pendek daripada 3,6 detik yang diukur modul ini sendiri sebagai waktu
 * kedatangan bingkai pertama - artinya setiap dekoder dingin divonis sebelum sempat bekerja.
 * Yang dikunci tes-tes di bawah adalah KONTRAKNYA (dekoder yang benar-benar mati tetap
 * tertangkap), bukan tenggatnya; jadi hanya angka ini yang ikut bergerak.
 */
const TICK_LEWAT_TENGGAT = 24;

describe('watchdog gambar-hidup: sesudah vonis', () => {
    it('TIDAK memvonis sumber lambat yang beberapa tick-nya tanpa bingkai baru', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();
        const onPicture = vi.fn();

        video._frames = 5;
        startLivePictureWatch(video, { onPicture, onNoPicture });

        // Tick pertama menetapkan vonis "hidup".
        vi.advanceTimersByTime(500);
        expect(onPicture).toHaveBeenCalledTimes(1);

        /*
         * Sumber 1 fps: waktu terus maju tiap tick, tapi bingkai baru hanya datang tiap tick
         * kedua. Inilah bentuk yang dulu langsung divonis pada tick pertama yang kosong.
         */
        majukan(8, (i) => {
            video.currentTime += 0.5;
            if (i % 2 === 1) video._frames += 1;
        });

        expect(onNoPicture).not.toHaveBeenCalled();
    });

    it('MASIH menangkap dekoder yang benar-benar mati — bingkai membeku selamanya', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();

        video._frames = 5;
        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);

        // Waktu terus berjalan, bingkai tidak pernah bertambah lagi: persis gejala perangkat
        // yang menerima byte H.265 lalu gagal men-decode-nya.
        majukan(TICK_LEWAT_TENGGAT, () => {
            video.currentTime += 0.5;
        });

        expect(onNoPicture).toHaveBeenCalledTimes(1);
    });

    it('memaafkan jeda panjang lalu kembali normal, tanpa menyisakan vonis tertunda', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();

        video._frames = 5;
        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);

        // Empat tick sepi (2 detik) - di bawah ambang.
        majukan(4, () => {
            video.currentTime += 0.5;
        });
        expect(onNoPicture).not.toHaveBeenCalled();

        // Lalu bingkai datang lagi: hitungan sepi harus DIRESET, bukan diakumulasi.
        majukan(1, () => {
            video.currentTime += 0.5;
            video._frames += 1;
        });
        majukan(4, () => {
            video.currentTime += 0.5;
        });

        expect(onNoPicture).not.toHaveBeenCalled();
    });

    it('tidak memvonis saat waktu TIDAK maju (stream ter-pause / buffering)', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();

        video._frames = 5;
        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);

        // currentTime diam: tidak ada yang bisa disimpulkan, jadi jangan simpulkan apa pun.
        majukan(20);

        expect(onNoPicture).not.toHaveBeenCalled();
    });

    it('diam saja bila browser tidak melaporkan jumlah bingkai sama sekali', () => {
        const video = videoTiruan();
        delete video.getVideoPlaybackQuality;
        const onNoPicture = vi.fn();

        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);
        majukan(20, () => {
            video.currentTime += 0.5;
        });

        expect(onNoPicture).not.toHaveBeenCalled();
    });
});
/*
 * DILAPORKAN PEMILIK 2026-08-25: tiga kamera hitam pekat di sebagian perangkat, dengan lencana
 * LIVE menyala dan TANPA pesan galat apa pun. Ketiganya HEVC (hvc1), dua di antaranya tanpa trek
 * audio.
 *
 * Akar masalahnya ada di predikat vonis. hasPicture() dulu hanya memeriksa videoWidth/Height,
 * dan komentarnya mengklaim "Dimensions are only known once the decoder has actually described
 * a frame". Klaim itu SALAH untuk HLS/MSE: dimensi berasal dari metadata yang di-parse hls.js di
 * JavaScript, bukan dari dekoder. Diukur langsung di browser pada stream produksi 1444:
 * loadedmetadata, loadeddata, canplay, dan playing SEMUANYA menyala dengan videoWidth=2304
 * sementara totalVideoFrames masih 0; bingkai pertama baru datang 3,6 detik kemudian.
 *
 * Jadi perangkat yang menerima byte HEVC lalu gagal men-decode-nya memenuhi syarat vonis dengan
 * sempurna — persis kegagalan yang modul ini ditulis untuk mencegah. Dan vonis itu bukan label
 * salah yang terkoreksi belakangan: di VideoPopup ia melucuti LIMA penangan galat sekaligus,
 * yang semuanya diawali `if (... || isLive) return`.
 *
 * Penjaga sesudah-vonis pun tak bisa menyelamatkan: ia menuntut currentTime MAJU, sedangkan
 * dua dari tiga kamera itu tidak punya audio, jadi tidak ada apa pun yang menggerakkan jam saat
 * video mandek. Hasilnya persegi hitam permanen tanpa satu pun pesan.
 */
describe('vonis hidup menuntut bingkai, bukan sekadar dimensi', () => {
    it('menolak menyebut hidup saat dimensi ADA tetapi nol bingkai ter-decode', () => {
        const video = videoTiruan();
        video._frames = 0;

        expect(hasPicture(video)).toBe(false);
    });

    it('menyebut hidup begitu satu bingkai benar-benar ter-decode', () => {
        const video = videoTiruan();
        video._frames = 1;

        expect(hasPicture(video)).toBe(true);
    });

    /*
     * Safari pada sebagian versi tidak mengekspos penghitung mana pun. Di sana dimensi adalah
     * satu-satunya sinyal yang kita punya, dan memperlakukan "tidak tahu" sebagai "nol bingkai"
     * akan mematikan stream yang jalan normal.
     */
    it('kembali ke dimensi saja bila browser tidak melaporkan bingkai', () => {
        const video = videoTiruan();
        delete video.getVideoPlaybackQuality;

        expect(hasPicture(video)).toBe(true);
    });

    it('tidak memvonis hidup, dan akhirnya melapor gagal, untuk stream yang tak pernah men-decode', () => {
        const video = videoTiruan();
        const onPicture = vi.fn();
        const onNoPicture = vi.fn();
        video._frames = 0;

        startLivePictureWatch(video, { onPicture, onNoPicture });

        // Byte mengalir, dimensi diketahui, tapi dekoder tidak menghasilkan apa pun.
        majukan(10);
        expect(onPicture).not.toHaveBeenCalled();
        expect(onNoPicture).not.toHaveBeenCalled();

        // Sesudah tenggat noPictureAfterMs, pengunjung HARUS diberi tahu — bukan dibiarkan
        // menatap persegi hitam yang mengaku LIVE.
        majukan(24);
        expect(onNoPicture).toHaveBeenCalledTimes(1);
    });
});

/*
 * DILAPORKAN PEMILIK 2026-08-26: "bug codec melebar kemana mana". Live berjalan normal, lalu
 * pengguna pindah ke aplikasi lain dan kembali - panel "Codec Tidak Didukung" muncul, TANPA
 * tombol coba lagi. Menutup tampilan live lalu membukanya lagi selalu menyembuhkan.
 *
 * Vonisnya tidak ada hubungannya dengan codec. totalVideoFrames bersifat kumulatif untuk satu
 * pipeline media dan KEMBALI KE NOL setiap kali pipeline itu dibangun ulang - terukur langsung
 * di Chromium pada stream produksi: 1636 bingkai, pipeline dibangun ulang, lalu 0. Android
 * melakukan persis itu saat aplikasi kembali dari latar belakang.
 *
 * Syarat lama `frames > framesAtVerdict` tidak akan pernah terpenuhi lagi sesudah reset sampai
 * ribuan bingkai berikutnya ter-decode (~1 menit pada 25 fps), sedangkan tenggat macetnya tiga
 * detik - dan stalledSince hanya direset di dalam cabang yang tak terjangkau itu. Jadi vonisnya
 * PASTI jatuh pada stream yang memutar dengan sempurna, lalu terkunci.
 *
 * Membuka ulang popup menyembuhkannya karena watchdog baru membasiskan penghitungnya dari nol.
 */
describe('pipeline media dibangun ulang (aplikasi kembali dari latar belakang)', () => {
    it('TIDAK memvonis stream sehat ketika penghitung bingkai kembali ke nol', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();

        video._frames = 5000;
        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);

        majukan(6, () => { video.currentTime += 0.5; video._frames += 12; });
        expect(onNoPicture).not.toHaveBeenCalled();

        // Dekodernya direbut lalu dibuat lagi: penghitung ke nol, pemutaran berlanjut 25 fps.
        video._frames = 0;
        majukan(20, () => { video.currentTime += 0.5; video._frames += 12; });

        expect(video._frames).toBeGreaterThan(0);
        expect(video._frames).toBeLessThan(5000);
        expect(onNoPicture, 'stream yang jelas mendekode divonis mati').not.toHaveBeenCalled();
    });

    it('MASIH menangkap pipeline yang dibangun ulang lalu benar-benar mati', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();

        video._frames = 5000;
        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);

        video._frames = 0;
        majukan(1, () => { video.currentTime += 0.5; });   // tick yang membasiskan ulang
        majukan(TICK_LEWAT_TENGGAT, () => { video.currentTime += 0.5; });  // lalu bingkainya membeku selamanya

        expect(onNoPicture).toHaveBeenCalledTimes(1);
    });

    it('mereset jam macet saat video dijeda, bukan meneruskannya sesudah kembali', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();

        video._frames = 5;
        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);

        /*
         * Bentuk pertama tes ini TIDAK diskriminatif: ia hanya menjeda beberapa tick, padahal saat
         * dijeda currentTime memang tidak maju sehingga `!advanced` sudah menahan vonis lebih dulu.
         * Menghapus penjaga jedanya membuat tes itu tetap hijau. Yang benar-benar dijaganya adalah
         * RESET jam macetnya - jadi separuh anggaran dihabiskan SEBELUM jeda dan separuh lagi
         * SESUDAHNYA. Tanpa reset, keduanya berjumlah genap satu tenggat.
         */
        majukan(10, () => { video.currentTime += 0.5; });  // 5 dtk sepi: separuh tenggat
        expect(onNoPicture).not.toHaveBeenCalled();

        video.paused = true;                               // usePauseOnHidden menjeda saat tersembunyi
        majukan(10);
        video.paused = false;
        video.currentTime += 30;                           // kembali: snap ke live edge

        majukan(11, () => { video.currentTime += 0.5; });  // 5,5 dtk sepi lagi - harus dihitung ULANG

        expect(onNoPicture).not.toHaveBeenCalled();
    });
});

/*
 * Watchdog melaporkan APA YANG DIAMATI; pemanggilnya yang memutuskan cara bicara. Sebelumnya
 * kedua situasi di bawah dijawab dengan vonis codec yang sama, padahal yang kedua justru bukti
 * bahwa perangkatnya MAMPU.
 */
describe('watchdog memisahkan "tidak pernah ada gambar" dari "gambar berhenti"', () => {
    it('everHadPicture=false saat bingkai tidak pernah ada sama sekali', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();
        video._frames = 0;

        startLivePictureWatch(video, { onNoPicture });
        majukan(34);

        expect(onNoPicture).toHaveBeenCalledWith({ everHadPicture: false });
    });

    it('everHadPicture=true saat gambar pernah ada lalu berhenti', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();
        video._frames = 5;

        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);
        majukan(TICK_LEWAT_TENGGAT, () => { video.currentTime += 0.5; });

        expect(onNoPicture).toHaveBeenCalledWith({ everHadPicture: true });
    });
});

/*
 * Jalur KEDUA yang menghasilkan gejala yang sama, dan yang paling menjelaskan kenapa gejalanya
 * terasa acak: seluruh tenggat di modul ini diukur dengan Date.now() - jam DINDING - sedangkan
 * setInterval-nya dibekukan browser saat tab tersembunyi. Satu tick sepi yang kebetulan mendarat
 * tepat sebelum pengguna pindah aplikasi menyisakan stalledSince yang terisi; tick pertama sesudah
 * ia kembali menemukan SELURUH durasi latar belakang sudah lewat, dan memvonis dari satu sampel.
 */
describe('interval yang dibekukan browser', () => {
    it('tidak menghitung waktu yang TIDAK diamati sebagai bukti macet', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();

        video._frames = 5;
        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);

        // Satu tick sepi mendarat tepat sebelum aplikasi ditinggalkan.
        majukan(1, () => { video.currentTime += 0.5; });

        // Dua menit di latar belakang: jam dinding maju, interval TIDAK berjalan sama sekali.
        vi.setSystemTime(Date.now() + 120000);

        // Kembali. Dekodernya masih dingin beberapa tick - itu tidak boleh langsung divonis.
        majukan(4, () => { video.currentTime += 0.5; });

        expect(onNoPicture, 'dua menit yang tak teramati dihitung sebagai macet').not.toHaveBeenCalled();
    });

    it('tetap memvonis kalau sesudah kembali bingkainya memang tidak pernah datang lagi', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();

        video._frames = 5;
        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);
        vi.setSystemTime(Date.now() + 120000);

        // Penjaga di atas membasiskan ulang, ia tidak melucuti watchdog untuk selamanya.
        majukan(TICK_LEWAT_TENGGAT + 1, () => { video.currentTime += 0.5; });

        expect(onNoPicture).toHaveBeenCalledTimes(1);
    });
});

/*
 * Sisi SEBALIKNYA dari penjaga waktu-teramati, dan alasan ia berupa AKUMULATOR dan bukan penjaga
 * biner "kalau jedanya tak wajar, buang tenggatnya".
 *
 * Penjaga biner menutup kasus latar-belakang tetapi membuka lubang yang lebih buruk: perangkat
 * lemah yang tick-nya rutin telat SAAT PENGGUNA MENONTON tidak akan pernah mengumpulkan tenggat
 * apa pun, jadi watchdog-nya lumpuh diam-diam - dan bug asli "layar hitam ber-badge LIVE" hidup
 * lagi tanpa satu pun tes memerah. Akumulator tidak punya tebing itu: tiap tick tetap menyumbang,
 * hanya dibatasi dua interval.
 */
describe('tick yang lambat terus-menerus (perangkat lemah, bukan latar belakang)', () => {
    it('TETAP memvonis dekoder mati walau tiap tick telat jauh di atas intervalnya', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();

        video._frames = 5;
        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);

        // 30 tick, masing-masing terlambat ~3,5 detik. Bingkai membeku, waktu media terus maju.
        for (let i = 0; i < 30; i += 1) {
            video.currentTime += 0.5;
            vi.setSystemTime(Date.now() + 3000);
            vi.advanceTimersByTime(500);
        }

        expect(onNoPicture, 'watchdog lumpuh oleh tick lambat').toHaveBeenCalledTimes(1);
    });

    it('satu tick tidak boleh menyumbang lebih dari dua interval ke tenggat', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();

        video._frames = 5;
        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);

        // Empat tick, masing-masing menyeberangi 60 detik jam dinding. Kalau jam dinding yang
        // dipakai, ini 240 detik dan vonisnya jatuh seketika; dengan batas dua interval ini
        // hanya bernilai 4 detik teramati - di bawah tenggat 10 detik.
        for (let i = 0; i < 4; i += 1) {
            video.currentTime += 0.5;
            vi.setSystemTime(Date.now() + 60000);
            vi.advanceTimersByTime(500);
        }

        expect(onNoPicture).not.toHaveBeenCalled();
    });
});

/*
 * TEMUAN PEMERIKSAAN ADVERSARIAL 2026-08-26: penjaga halaman-tersembunyi semula hanya dipasang di
 * cabang PASCA-vonis, sehingga bentuk keluhan yang sama persis masih bisa jatuh - hanya bergeser
 * ke fase memuat. Buka kamera, langsung pindah aplikasi sebelum gambar pertama muncul, lalu
 * kembali: "Codec Tidak Didukung" tanpa tombol coba lagi, pada perangkat yang belum pernah diberi
 * satu pun kesempatan mendekode.
 */
describe('halaman tersembunyi SEBELUM gambar pertama muncul', () => {
    const sembunyikan = (nilai) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => nilai });
    };
    afterEach(() => { sembunyikan(false); });

    it('TIDAK memvonis codec selama halamannya tidak terlihat', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();
        video._frames = 0;

        startLivePictureWatch(video, { onNoPicture });
        sembunyikan(true);
        video.paused = true;                  // usePauseOnHidden menjeda begitu tab tersembunyi

        majukan(60);                          // 30 detik: dua kali tenggat noPictureAfterMs

        expect(onNoPicture, 'divonis tanpa pernah diberi kesempatan mendekode').not.toHaveBeenCalled();
    });

    /*
     * Yang MEMAKU penjaga halaman-tersembunyi, dan bukan penjaga jeda di sebelahnya.
     *
     * Audit mutasi menunjukkan tes di atas tetap hijau ketika penjaga tersembunyi dilumpuhkan -
     * karena di sana videonya juga DIJEDA, dan penjaga jeda menangkapnya duluan. Keduanya harus
     * ada: usePauseOnHidden hanya menjeda video yang SEDANG memutar, jadi stream yang masih
     * memuat saat pengguna pindah aplikasi tetap paused=false sambil halamannya tersembunyi -
     * dan di situ penjaga tersembunyi adalah satu-satunya yang berdiri.
     */
    it('menahan vonis saat halaman tersembunyi walau videonya TIDAK dijeda', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();
        video._frames = 0;
        video.paused = false;

        startLivePictureWatch(video, { onNoPicture });
        sembunyikan(true);

        majukan(60);                          // 30 detik: dua kali tenggat

        expect(onNoPicture, 'hanya penjaga tersembunyi yang berdiri di sini').not.toHaveBeenCalled();
    });

    it('tidak lumpuh: begitu terlihat lagi, tenggatnya berjalan seperti biasa', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();
        video._frames = 0;

        startLivePictureWatch(video, { onNoPicture });
        sembunyikan(true);
        video.paused = true;
        majukan(60);
        expect(onNoPicture).not.toHaveBeenCalled();

        sembunyikan(false);
        video.paused = false;
        majukan(34);                          // 17 detik teramati, di atas tenggat 15 detik

        expect(onNoPicture).toHaveBeenCalledWith({ everHadPicture: false });
    });
});

/*
 * Anggaran tenggat pra-vonis tidak boleh menyeberangi putusnya aliran data. hasMediaData mati pada
 * setiap destroy()+attachMedia (jalur coba-ulang otomatis) dan saat lompat ke live edge; tanpa
 * reset, tick pertama sesudah data kembali memvonis dari SATU sampel karena anggaran percobaan
 * SEBELUMNYA nyaris habis.
 */
describe('aliran data terputus lalu kembali', () => {
    it('memulai tenggat dari nol, bukan melanjutkan anggaran percobaan sebelumnya', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();
        video._frames = 0;

        startLivePictureWatch(video, { onNoPicture });

        majukan(28);                          // 14 detik: tepat di bawah tenggat
        expect(onNoPicture).not.toHaveBeenCalled();

        video.readyState = 1;                 // data putus - hls.js dibangun ulang
        video.buffered = { length: 0 };
        majukan(4);

        video.readyState = 4;                 // data kembali: ini percobaan BARU
        video.buffered = { length: 1 };
        majukan(4);

        expect(onNoPicture, 'sisa anggaran lama dipakai memvonis percobaan baru').not.toHaveBeenCalled();
    });

    /*
     * Bentuk kedua dari anggaran yang menyeberang: videonya DIJEDA di tengah jalan. Di ponsel ini
     * rutin - kebijakan autoplay menolak, atau usePauseOnHidden menjeda sekejap - dan tanpa reset,
     * anggaran yang nyaris habis sebelum jeda memvonis percobaan sesudahnya dari satu-dua sampel.
     */
    it('juga memulai dari nol sesudah videonya sempat dijeda', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();
        video._frames = 0;

        startLivePictureWatch(video, { onNoPicture });

        majukan(28);                          // 14 detik: tepat di bawah tenggat
        expect(onNoPicture).not.toHaveBeenCalled();

        video.paused = true;                  // autoplay ditolak / dijeda sekejap
        video.currentTime = 3;
        majukan(4);

        video.paused = false;
        majukan(4);

        expect(onNoPicture, 'anggaran menyeberangi jeda').not.toHaveBeenCalled();
    });
});
