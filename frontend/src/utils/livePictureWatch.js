/**
 * Purpose: Decide when a live stream is genuinely PLAYING — by proving a picture exists, not by
 *          observing that bytes arrived — and keep watching after that verdict.
 * Caller: VideoPopup, MultiViewVideoItem (extracted from their duplicated startPlaybackCheck).
 * Deps: HTML media element APIs only.
 * MainFuncs: hasPicture, countDecodedFrames, startLivePictureWatch.
 * SideEffects: One interval per watch; cleared by the returned stop().
 *
 * WHY THIS EXISTS
 * ---------------
 * Both players used to declare a stream live on `readyState >= 3 && buffered.length > 0`. That
 * means "the browser accepted bytes", which is NOT the same as "a frame was decoded and shown" —
 * and the gap between those two is exactly where a black screen lives. A device that takes the
 * HEVC bytes and then fails to decode them satisfies the old test perfectly.
 *
 * What made it permanent was the reaction to that verdict: declaring live clears the loading
 * timeout, stops the poll, and every ERROR handler in both players begins with `|| isLive` and
 * returns. So a wrong "live" is not a wrong label that later corrects itself — it disarms every
 * remaining chance to notice, and the viewer keeps a black rectangle marked LIVE forever.
 *
 * So the verdict now needs a picture, and the watch does not end at the verdict.
 */

/**
 * A frame has actually been DECODED — not merely described.
 *
 * This used to be dimensions alone, on the belief that "dimensions are only known once the
 * decoder has described a frame". That belief is wrong for HLS/MSE: hls.js parses the track
 * metadata in JavaScript and hands it to the media element, so videoWidth is populated with no
 * decoder involvement at all. Measured against production stream 1444 in a real browser:
 * loadedmetadata, loadeddata, canplay AND playing all fired with videoWidth=2304 while
 * totalVideoFrames was still 0; the first frame arrived 3.6s later.
 *
 * So a device that accepts HEVC bytes and then fails to decode them satisfied this test
 * perfectly — the exact failure this module was written to prevent, committed by the module
 * itself. Three public cameras were reported as a permanently black rectangle wearing a LIVE
 * badge, with no error, because declaring live disarms all five error handlers in VideoPopup.
 *
 * Dimensions are still required: they are what proves a VIDEO track exists at all.
 */
export function hasPicture(video) {
    if (!video || !(video.videoWidth > 0) || !(video.videoHeight > 0)) {
        return false;
    }
    const frames = countDecodedFrames(video);
    // null means the browser refuses to say (some Safari builds). Dimensions are the only
    // signal available there, and treating "unknown" as "none" would kill streams that play.
    return frames === null || frames > 0;
}

/**
 * Frames the decoder has produced, or `null` where the browser will not say.
 *
 * `null` is a real answer and must not be read as zero: Safari exposes neither counter on some
 * versions, and treating "unknown" as "no frames" would tear down streams that are playing fine.
 */
export function countDecodedFrames(video) {
    if (!video) return null;
    const quality = video.getVideoPlaybackQuality?.();
    if (quality && typeof quality.totalVideoFrames === 'number') {
        return quality.totalVideoFrames;
    }
    if (typeof video.webkitDecodedFrameCount === 'number') {
        return video.webkitDecodedFrameCount;
    }
    return null;
}

/** Bytes reached the buffer — necessary for a picture, nowhere near sufficient. */
function hasMediaData(video) {
    return video.readyState >= 3 && video.buffered?.length > 0;
}

/**
 * Watch one <video> and answer exactly one of two questions, then keep answering the second.
 *
 * onPicture()   — data is flowing AND a frame exists. Safe to call this stream live.
 * onNoPicture() — data kept flowing and time kept advancing, but no picture ever appeared
 *                 (or the decoder produced zero frames). A silent decode failure.
 *
 * `requestPlay` is retained from the code this replaces: some browsers land in a paused state at
 * currentTime 0 with data buffered, and need nudging rather than diagnosing.
 */
export function startLivePictureWatch(video, {
    isStale = () => false,
    onPicture,
    onNoPicture,
    requestPlay,
    intervalMs = 500,
    // Generous on purpose. This deadline only starts counting once data is flowing, and a slow
    // phone decoding a 2560x1440 stream can legitimately take several seconds to show frame one.
    // Firing early would turn a slow stream into a false "unsupported" verdict.
    noPictureAfterMs = 15000,
    /*
     * Berapa lama waktu boleh maju TANPA satu pun bingkai baru sebelum dekodernya divonis mati.
     *
     * Ini dulu nol: satu tick sepi langsung memvonis. Pada tick 500 ms itu berarti sumber apa pun
     * di bawah ~4 fps rutin menghasilkan tick tanpa bingkai baru dan divonis "codec tidak
     * didukung" padahal gambarnya jalan. Tidak terlihat selama watchdog ini hanya menjaga ubin
     * Multi-View; menjadi berbahaya begitu ia memegang pemutar utama, karena 182 kamera publik
     * memakai origin HLS pihak ketiga yang laju bingkainya di luar kendali kita.
     *
     * Tiga detik mentoleransi sumber selambat ~0,33 fps namun tetap menangkap dekoder yang
     * benar-benar mati dalam tiga detik — bingkainya membeku SELAMANYA, jadi menunggu sebentar
     * tidak menghilangkan bukti, hanya menghindari menuduh yang lambat.
     *
     * DINAIKKAN dari 3000 (2026-08-26). Tiga detik lebih PENDEK daripada angka yang diukur modul
     * ini sendiri di baris 30-32: bingkai pertama pernah datang 3,6 detik sesudah `playing`. Jadi
     * setiap dekoder yang dingin - termasuk yang baru dibangun ulang saat aplikasi kembali dari
     * latar belakang - dijamin melewati tenggatnya sebelum sempat menghasilkan bingkai pertama.
     * Jalur start-dingin diberi 15 detik untuk masalah yang persis sama (noPictureAfterMs); tidak
     * ada alasan jalur ini jauh lebih galak. Dekoder yang benar-benar mati membeku SELAMANYA,
     * jadi menunggu lebih lama tidak menghilangkan bukti - hanya berhenti menuduh yang dingin.
     */
    stalledGiveUpMs = 10000,
} = {}) {
    if (!video) return () => {};

    let timer = null;
    let live = false;
    let framesAtVerdict = null;
    let stillTimeAdvancing = null;
    let lastTickAt = null;
    // Kedua tenggat di bawah dihitung dalam WAKTU YANG DIAMATI, bukan jam dinding. Lihat tick().
    let dataMs = 0;
    let stalledMs = 0;

    const stop = () => {
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    };

    /*
     * Melaporkan APA YANG DIAMATI, bukan menyimpulkan penyebabnya.
     *
     * `everHadPicture` memisahkan dua situasi yang sebelumnya dijawab dengan vonis yang sama:
     *   false - bingkai TIDAK PERNAH ada. Perangkat mengambil byte lalu tidak menghasilkan apa
     *           pun; "codec tidak didukung" masuk akal di sini.
     *   true  - bingkai SUDAH pernah ada, lalu berhenti. Perangkat ini TERBUKTI bisa mendekode
     *           stream ini, jadi apa pun penyebabnya, "codec tidak didukung" adalah kebohongan.
     *
     * Pemanggilnya yang memutuskan cara bicara; modul ini hanya melapor.
     */
    const giveUp = () => {
        stop();
        onNoPicture?.({ everHadPicture: live });
    };

    const tick = () => {
        if (isStale()) {
            stop();
            return;
        }

        /*
         * BERAPA LAMA KAMI BENAR-BENAR MENGAMATI SEJAK TICK LALU.
         *
         * Kedua tenggat di bawah dulu diukur dengan Date.now() - jam DINDING - padahal interval
         * ini dibekukan browser saat tab tersembunyi. TERUKUR di Chromium pada halaman produksi:
         * interval yang diminta 500 ms benar-benar menembak sekali per 60.000 ms di tab
         * tersembunyi. Jadi tick pertama sesudah pengguna kembali menemukan 60 detik sudah lewat
         * - 6x tenggat macet - dan memvonis dari SATU sampel, pada stream yang sehat.
         *
         * Menjawabnya dengan "kalau jedanya tak wajar, buang seluruh tenggatnya" salah ke arah
         * sebaliknya: perangkat yang tick-nya rutin telat saat pengguna MENONTON tidak akan
         * pernah mengumpulkan tenggat apa pun, jadi watchdog-nya lumpuh diam-diam dan bug asli
         * "layar hitam ber-badge LIVE" hidup lagi - tepat kegagalan yang modul ini cegah.
         *
         * Jadi waktunya DIAKUMULASI, dengan batas satu tick tidak boleh menyumbang lebih dari
         * dua interval. Celah 60 detik menyumbang 1 detik; tick normal 500 ms menyumbang 500 ms.
         * Tidak ada tebing, tidak ada cara melumpuhkannya, dan waktu yang tidak diamati tetap
         * tidak pernah dihitung sebagai bukti.
         */
        const sekarang = Date.now();
        const jeda = lastTickAt === null ? intervalMs : sekarang - lastTickAt;
        lastTickAt = sekarang;
        const teramati = Math.min(jeda, intervalMs * 2);

        /*
         * HALAMANNYA TIDAK TERLIHAT - dan ini berlaku untuk KEDUA cabang di bawah.
         *
         * Penjaga ini semula hanya dipasang di cabang PASCA-vonis, dan itu meninggalkan bentuk
         * keluhan yang sama persis, hanya bergeser ke fase memuat: usePauseOnHidden MENJEDA video
         * begitu halaman tersembunyi, sementara tenggat noPictureAfterMs di cabang pra-vonis terus
         * mengumpulkan waktu. Artinya dekodernya dilarang menghasilkan bukti yang dituntut tenggat
         * itu. Pengunjung yang membuka kamera lalu langsung pindah aplikasi sebelum gambar pertama
         * muncul akan kembali ke "Codec Tidak Didukung" TANPA tombol coba lagi - vonis kemampuan
         * perangkat yang dijatuhkan tanpa satu pun kesempatan mendekode.
         *
         * Akumulator waktu-teramati tidak menolong di sini: tiap tick tetap menyumbang, jadi 15
         * tick di latar belakang tetap genap 15 detik. Yang salah bukan lajunya, melainkan
         * menghitungnya sama sekali saat tidak ada yang bisa diamati.
         */
        if (typeof document !== 'undefined' && document.hidden) {
            dataMs = 0;
            stalledMs = 0;
            stillTimeAdvancing = video.currentTime;
            if (live) framesAtVerdict = countDecodedFrames(video);
            return;
        }

        if (!live) {
            /*
             * Aliran data putus = percobaan ini mulai dari nol, bukan melanjutkan anggaran lama.
             * hasMediaData mati pada setiap destroy()+attachMedia (jalur coba-ulang otomatis) dan
             * saat lompat ke live edge. Tanpa reset ini, tick pertama sesudah data kembali bisa
             * memvonis dari SATU sampel, karena anggaran 15 detiknya nyaris habis di percobaan
             * sebelumnya.
             */
            if (!hasMediaData(video)) {
                dataMs = 0;
                return;
            }
            // Dijeda: masih boleh disenggol, tapi waktunya tidak dihitung. Video yang berhenti
            // tidak bisa membuktikan apa pun - termasuk saat pengunjung sendiri yang menjedanya.
            if (video.paused) {
                if (!(video.currentTime > 0)) requestPlay?.(video);
                dataMs = 0;
                return;
            }
            if (hasPicture(video)) {
                live = true;
                framesAtVerdict = countDecodedFrames(video);
                stillTimeAdvancing = video.currentTime;
                onPicture?.();
                return;
            }
            dataMs += teramati;
            if (dataMs >= noPictureAfterMs) giveUp();
            return;
        }

        // Past the verdict. The stream said it was live; make it keep proving it. A decoder that
        // dies mid-stream leaves currentTime advancing while the frame counter stands still,
        // and it stays that way — so this waits stalledGiveUpMs before believing it.
        // the one shape that produces a black rectangle nothing else in the app would question.
        const frames = countDecodedFrames(video);

        /*
         * Dijeda, atau halamannya tidak terlihat: JANGAN menyimpulkan apa pun, dan yang lebih
         * penting jangan menyisakan jam macet yang sudah berjalan. usePauseOnHidden menjeda
         * video begitu tab tersembunyi, sementara setInterval di sini ikut di-throttle browser —
         * jadi tick berikutnya bisa mendarat jauh setelah pemutaran dilanjutkan, saat waktu sudah
         * melompat tetapi dekodernya baru dibangun ulang. Membasiskan ulang di sini membuat tick
         * pertama sesudah kembali menjadi titik nol yang jujur, bukan sisa pengamatan lama.
         */
        if (video.paused) {
            stillTimeAdvancing = video.currentTime;
            stalledMs = 0;
            return;
        }

        const advanced = video.currentTime > stillTimeAdvancing;
        if (!advanced) return;
        stillTimeAdvancing = video.currentTime;
        if (frames === null || framesAtVerdict === null) return;
        /*
         * BERUBAH, bukan BERTAMBAH — dan perbedaan itu adalah keseluruhan bug ini.
         *
         * totalVideoFrames bersifat kumulatif untuk satu pipeline media, dan ia KEMBALI KE NOL
         * setiap kali pipeline itu dibangun ulang. Terukur langsung di Chromium pada stream
         * produksi: 1636 bingkai, pipeline dibangun ulang, lalu 0. Android melakukan persis itu
         * saat aplikasi kembali dari latar belakang dan dekoder perangkat kerasnya direbut lalu
         * dibuat lagi; hls.js melakukannya sendiri lewat recoverMediaError().
         *
         * Dengan syarat lama `frames > framesAtVerdict`, penghitung yang baru direset TIDAK AKAN
         * PERNAH melampaui garis dasar lama sampai ribuan bingkai berikutnya ter-decode - sekitar
         * satu menit pada 25 fps, sedangkan tenggat macetnya tiga detik. Jadi vonisnya PASTI
         * jatuh, pada stream yang memutar dengan sempurna, dan jam macetnya tidak pernah
         * direset karena satu-satunya tempat yang meresetnya ada di dalam cabang ini.
         *
         * Penghitung yang MUNDUR berarti dekoder BARU, bukan dekoder mati. Basiskan ulang.
         */
        if (frames !== framesAtVerdict) {
            framesAtVerdict = frames;
            stalledMs = 0;
            return;
        }
        // Sepi. Kumpulkan waktu yang DIAMATI saja - lihat stalledGiveUpMs.
        stalledMs += teramati;
        if (stalledMs >= stalledGiveUpMs) giveUp();
    };

    timer = setInterval(tick, intervalMs);
    return stop;
}
