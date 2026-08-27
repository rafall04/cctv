/*
 * Purpose: Satu kosakata pengungkapan komersial untuk seluruh permukaan publik.
 * Caller: AffiliateOfferCard, PromoBanner, InlineAdSlot, SponsorStrip.
 * Deps: none.
 * MainFuncs: disclosureFor.
 * SideEffects: None.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Sebelum ini, EMPAT jenis konten komersial melabeli dirinya sendiri di empat berkas berbeda
 * dengan empat cara berbeda: "Toko rekanan" ditulis langsung di AffiliateOfferCard, "Promo" di
 * PromoBanner, "Iklan" sebagai nilai default prop di InlineAdSlot, dan "Sponsor Kami" sebagai
 * judul seksi di SponsorStrip.
 *
 * Selama tiap komponen yang memutuskan, jenis KELIMA akan tayang tanpa label - bukan karena ada
 * yang memutuskan begitu, melainkan karena tidak ada satu tempat pun yang menuntutnya. Dan label
 * ini bukan hiasan: ia satu-satunya cara pengunjung tahu mana yang dibayar dan mana yang bukan.
 * Kehilangan satu label adalah kehilangan kepercayaan, bukan kehilangan kosmetik.
 *
 * KENAPA MELEMPAR, BUKAN MEMBERI NILAI CADANGAN
 * Nilai cadangan yang aman ("Iklan") justru bentuk kegagalan yang mau dicegah: jenis baru akan
 * tayang dengan label yang salah dan tidak ada yang tahu. Daftar jenis di sini tertutup dan
 * diketahui saat kompilasi, jadi jenis tak dikenal adalah galat pemrograman - dan galat
 * pemrograman harus berisik. Tesnya membuktikan setiap pemanggil mengoper jenis yang sah.
 */

/**
 * Label pengungkapan per jenis konten. Teksnya PERSIS seperti yang sudah tayang sebelum
 * kosakata ini dipusatkan - memusatkan keputusan tidak boleh sekalian mengubah tampilan.
 *
 * Huruf besarnya diurus CSS di masing-masing permukaan (`uppercase`), bukan di sini, supaya
 * pembaca layar tetap mendengar kata yang wajar.
 */
export const DISCLOSURE = Object.freeze({
    /** Barang mitra dengan tautan afiliasi. Beri tahu bahwa ini tautan berkomisi. */
    affiliate: 'Toko rekanan',
    /** Iklan milik RAF sendiri - jasa pemasangan. Tetap dilabeli walau bukan pihak ketiga. */
    promo: 'Promo',
    /** Iklan jaringan pihak ketiga yang TIDAK dikurasi RAF. */
    ads: 'Iklan',
    /** Kredit pendukung, bukan penjualan. Karena itu bunyinya berbeda dari tiga di atas. */
    sponsor: 'Sponsor Kami',
});

/** Jenis yang sah, untuk dipakai tes dan arbiter. */
export const COMMERCIAL_KINDS = Object.freeze(Object.keys(DISCLOSURE));

/**
 * Label pengungkapan untuk satu jenis konten komersial.
 *
 * @param {'affiliate'|'promo'|'ads'|'sponsor'} kind
 * @returns {string}
 * @throws {Error} bila jenisnya tidak terdaftar - lihat catatan di atas.
 */
export function disclosureFor(kind) {
    const label = DISCLOSURE[kind];
    if (!label) {
        throw new Error(`Jenis konten komersial tanpa label pengungkapan: ${String(kind)}`);
    }
    return label;
}

export default disclosureFor;
