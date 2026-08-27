/*
 * Purpose: Satu slot komersial di satu permukaan — satu penghuni, tidak pernah menumpuk.
 * Caller: VideoPopup, Playback, AreaPublicPage, LandingPage, LandingPageSimple.
 * Deps: commercialSlotService (arbiter di server), AffiliateOfferCard, PromoBanner.
 * MainFuncs: CommercialSlot.
 * SideEffects: Satu GET saat slot mendekati layar; GET itulah yang menghitung impresi pemenang.
 *
 * KENAPA KOMPONEN INI ADA
 * -----------------------
 * Ia menggantikan pasangan <AffiliateOfferSlot /> + <PromoBanner /> yang selama ini dipasang
 * berdampingan di lima permukaan. Keduanya mengambil datanya sendiri tanpa tahu yang lain ada,
 * jadi satu popup bisa menampilkan kartu afiliasi DAN banner promo sekaligus — di layar ponsel,
 * yang dipakai 79% penonton.
 *
 * Yang dijual permukaan ini bukan impresi melainkan KELANGKAAN: CTR afiliasi terukur 12,6%
 * sementara norma banner display di bawah 1%, dan angka setinggi itu muncul karena satu tawaran
 * relevan tampil sendirian.
 *
 * KENAPA PENGAMBILANNYA DITUNDA
 * Ditunda sampai slotnya mendekati layar, persis seperti dua komponen yang digantikannya. Server
 * menghitung impresi pada GET itu, jadi penundaan inilah yang membuat "impresi" berarti bloknya
 * benar-benar sampai ke layar — bukan sekadar bahwa sebuah popup dibuka.
 *
 * KENAPA TIDAK MERENDER RANGKA SAAT KOSONG
 * Saat tidak ada penghuni, komponen ini tidak merender apa pun: tanpa wadah, tanpa tinggi
 * cadangan, tanpa garis pemisah. Ruang kosong berbingkai adalah cara halaman terlihat penuh iklan
 * justru ketika tidak ada iklan sama sekali.
 */

import { useEffect, useRef, useState } from 'react';
import AffiliateOfferCard from './AffiliateOfferCard.jsx';
import PromoBanner from '../promo/PromoBanner.jsx';
import { resolveCommercialSlotOnce } from '../../services/commercialSlotService.js';

/**
 * @param {object} props
 * @param {'popup'|'area'|'landing'|'playback'} props.placement - permukaan yang meminta
 * @param {number|null} [props.cameraId] - kamera yang sedang ditonton, bila ada
 * @param {number|null} [props.areaId] - area yang sedang dibuka, bila tidak ada kamera tunggal
 * @param {string} [props.className] - chrome pembungkus; hanya dipakai bila ada penghuni
 */
export default function CommercialSlot({ placement, cameraId = null, areaId = null, className = '' }) {
    const [penghuni, setPenghuni] = useState(null);
    const wrapperRef = useRef(null);

    // Konteks berganti (popup pindah kamera): buang penghuni lama supaya poster kamera sebelumnya
    // tidak sempat menggantung di atas konteks baru sementara pengambilan berikutnya berjalan.
    useEffect(() => {
        setPenghuni(null);
    }, [placement, cameraId, areaId]);

    useEffect(() => {
        let dibatalkan = false;
        const node = wrapperRef.current;
        if (!node || !placement) {
            return undefined;
        }

        const ambil = async () => {
            const hasil = await resolveCommercialSlotOnce({ placement, cameraId, areaId });
            // Layanannya tidak pernah melempar, jadi tidak ada yang perlu ditangkap di sini.
            if (!dibatalkan) setPenghuni(hasil || null);
        };

        if (typeof IntersectionObserver !== 'function') {
            ambil();
            return () => { dibatalkan = true; };
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                // Diputus SEBELUM mengambil: menggulir halaman tidak boleh bisa mengantre
                // pengambilan kedua (dan impresi kedua) untuk pemasangan yang sama.
                observer.disconnect();
                ambil();
            }
        }, { rootMargin: '200px' });

        observer.observe(node);
        return () => {
            dibatalkan = true;
            observer.disconnect();
        };
    }, [placement, cameraId, areaId]);

    return (
        // data-placement menyebut permukaan yang diwakili pemasangan ini, terbaca dari tes
        // peramban: dengan lima pemasangan hidup, "sebuah blok dirender" tidak lagi cukup spesifik.
        <div ref={wrapperRef} data-testid="commercial-slot" data-placement={placement} data-kind={penghuni?.kind || undefined}>
            {penghuni?.kind === 'affiliate' && (
                <div className={className || undefined}>
                    <AffiliateOfferCard offer={penghuni.content} placement={placement} />
                </div>
            )}
            {penghuni?.kind === 'promo' && (
                <PromoBanner
                    promo={penghuni.content}
                    placement={placement}
                    cameraId={cameraId}
                    areaId={areaId}
                    className={className}
                />
            )}
        </div>
    );
}
