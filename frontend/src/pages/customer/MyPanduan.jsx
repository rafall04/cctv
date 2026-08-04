/*
 * Purpose: Customer "Panduan" page — the full walkthrough for opening camera access
 *          (MikroTik dst-nat, ONT port forwarding, DDNS) so our server can pull the RTSP.
 * Caller: App.jsx /my/panduan route inside CustomerLayout.
 * Deps: none (static content; the server IP comes from runtime config).
 * MainFuncs: MyPanduan.
 * SideEffects: None.
 *
 * WHY THIS LIVES BEHIND LOGIN
 * ---------------------------
 * This page names our server's public IP and explains that customers forward a camera's RTSP
 * port to it. On a public page that is a free map for anyone scanning: which address to watch,
 * and what kind of device sits behind the forwards. Nobody who has not signed up needs it either
 * — the public page carries only what a prospect must know to self-qualify (public IP, not CGNAT).
 */

import { useEffect, useState } from 'react';
import apiClient from '../../services/apiClient';

// Placeholder shown until the real address arrives from the authenticated endpoint. The address
// itself is NEVER a constant here: this component compiles into a JS chunk that anybody can
// download without logging in, so baking it in would publish it to the whole internet — verified,
// not assumed (an earlier draft leaked it into dist/assets/MyPanduan-*.js).
const IP_MEMUAT = '(memuat…)';

const ONT_MEREK = [
    { merek: 'ZTE (F609, F660, F670L)', menu: 'Application → Port Forwarding', catatan: 'sebagian firmware: Security → Port Forwarding' },
    { merek: 'Huawei (HG8245, HG8245H5)', menu: 'Forward Rules → Port Mapping Configuration', catatan: null },
    { merek: 'Fiberhome (HG6245, HG6145)', menu: 'Application → Port Forwarding', catatan: 'sebagian: Advanced → NAT → Virtual Server' },
    { merek: 'Merek lain', menu: 'Cari kata Port Forwarding, Virtual Server, NAT, atau Port Mapping', catatan: null },
];

const isian = (ipServer) => [
    ['Nama / Application Name', 'CCTV RAF (bebas)'],
    ['Protocol', 'TCP'],
    ['External / WAN Port', '8554'],
    ['Internal / LAN Port', '554'],
    ['Internal / Server IP', 'IP kamera Anda, mis. 192.168.1.50'],
    ['Source IP (bila tersedia)', ipServer],
    ['Enable / Status', 'aktif'],
];

const Kode = ({ children }) => (
    <code className="rounded border border-edge bg-surface-sunken px-1.5 py-0.5 font-mono text-[0.92em] text-content">
        {children}
    </code>
);

const Kartu = ({ judul, children, aksen = false }) => (
    <section className={`rounded-card border border-edge bg-surface p-5 shadow-e1 ${aksen ? 'border-t-[3px] border-t-primary' : ''}`}>
        {judul && <h2 className="mb-3 text-lg font-bold text-content">{judul}</h2>}
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-content-muted">{children}</div>
    </section>
);

export default function MyPanduan() {
    const [caraAktif, setCaraAktif] = useState('mikrotik');
    const [ipServer, setIpServer] = useState(IP_MEMUAT);

    useEffect(() => {
        let batal = false;
        apiClient.get('/api/customer/setup-info')
            .then(({ data }) => {
                if (batal) return;
                // A missing value must read as missing, never as a confident wrong address.
                setIpServer(data?.data?.server_ip || null);
            })
            .catch(() => { if (!batal) setIpServer(null); });
        return () => { batal = true; };
    }, []);

    const ipTampil = ipServer === IP_MEMUAT
        ? IP_MEMUAT
        : (ipServer || 'hubungi kami untuk alamatnya');

    return (
        <div className="flex flex-col gap-4">
            <header className="flex flex-col gap-2">
                <h1 className="text-xl font-bold text-content sm:text-2xl">Panduan membuka akses kamera</h1>
                <p className="max-w-3xl text-sm leading-relaxed text-content-muted">
                    Kamera dan internetnya milik Anda. Yang perlu dilakukan sekali di awal hanyalah
                    memberi jalan masuk dari server kami ke kamera itu. Ikuti langkahnya di bawah —
                    kalau menu di perangkat Anda berbeda, kirim fotonya lewat WhatsApp dan kami
                    tunjukkan yang mana.
                </p>
            </header>

            <Kartu judul="Langkah 0 — cek dulu, jangan langsung setting" aksen>
                <p>
                    Satu hal menentukan bisa atau tidaknya, dan itu bukan merek kamera atau kecepatan
                    internet: <b className="text-content">apakah internet di lokasi punya IP publik.</b>{' '}
                    Kalau tidak, pengaturan apa pun tidak akan menolong.
                </p>
                <ol className="flex list-decimal flex-col gap-2 pl-5">
                    <li>Masuk ke halaman admin router/ONT, buka bagian <i>Status</i> atau <i>WAN</i>, catat IP-nya.</li>
                    <li>
                        Dari HP/laptop di WiFi yang sama, buka{' '}
                        <a href="https://api.ipify.org" target="_blank" rel="noreferrer" className="text-primary underline">api.ipify.org</a>, catat angkanya.
                    </li>
                    <li>
                        <b className="text-content">Sama persis</b> → Anda punya IP publik, lanjut.{' '}
                        <b className="text-content">Berbeda</b> → internet Anda lewat CGNAT dan kamera
                        tidak bisa dijangkau dari luar.
                    </li>
                </ol>
                <p className="text-xs text-content-subtle">
                    Petunjuk cepat: IP WAN yang diawali <Kode>100.64</Kode>–<Kode>100.127</Kode>,{' '}
                    <Kode>10.</Kode>, atau <Kode>192.168.</Kode> sudah pasti bukan IP publik.
                </p>
                <p className="rounded-control border border-status-warn/40 bg-status-warn/10 p-3 text-xs">
                    <b className="text-content">Kalau CGNAT:</b> ini diselesaikan di sisi ISP, bukan di
                    router Anda. Minta <b>IP publik</b> ke penyedia internet — banyak ISP
                    menyediakannya, sebagian menarik biaya bulanan tambahan.
                </p>
            </Kartu>

            <Kartu judul="Yang perlu disiapkan">
                <ul className="flex list-disc flex-col gap-2 pl-5">
                    <li><b className="text-content">IP lokal kamera</b> yang tetap, mis. <Kode>192.168.1.50</Kode>. Kunci lewat DHCP reservation supaya tidak berubah saat listrik mati.</li>
                    <li><b className="text-content">Port RTSP kamera</b> — hampir semua merek memakai <Kode>554</Kode>.</li>
                    <li><b className="text-content">Nama pengguna dan sandi kamera.</b> Ganti sandi bawaan pabrik lebih dulu.</li>
                    <li><b className="text-content">Akses admin ke router/ONT.</b> Pada ONT bawaan ISP, akun <Kode>user</Kode> biasanya tidak bisa membuka menu forwarding.</li>
                </ul>
            </Kartu>

            <section className="rounded-card border border-status-fault/40 bg-status-fault/5 p-5">
                <h2 className="mb-2 text-lg font-bold text-content">Satu aturan yang jangan dilewati</h2>
                <div className="flex flex-col gap-3 text-sm leading-relaxed text-content-muted">
                    <p>
                        Membuka port kamera ke seluruh internet berarti siapa pun yang memindai alamat
                        Anda bisa mencoba masuk — dan kamera CCTV termasuk sasaran favorit pemindai
                        otomatis. Yang perlu menjangkau kamera Anda cuma satu alamat:
                    </p>
                    <p className="rounded-control border border-edge bg-surface-sunken px-4 py-3 font-mono text-base font-bold text-content">
                        {ipTampil}
                    </p>
                    <p>
                        Batasi forwarding hanya ke alamat itu. Kalau perangkat Anda tidak menyediakan
                        pilihan tersebut, tetap bisa jalan — tapi wajib memakai sandi kamera yang kuat
                        dan port luar yang tidak umum seperti <Kode>8554</Kode>, bukan <Kode>554</Kode>.
                    </p>
                </div>
            </section>

            <div className="flex gap-1 rounded-control border border-edge bg-surface p-1">
                {[['mikrotik', 'MikroTik'], ['ont', 'ONT / modem ISP']].map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setCaraAktif(id)}
                        className={`flex-1 rounded-control px-4 py-2 text-sm font-semibold transition-colors ${
                            caraAktif === id ? 'bg-primary text-white' : 'text-content-muted hover:bg-surface-sunken'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {caraAktif === 'mikrotik' && (
                <Kartu judul="MikroTik">
                    <p>
                        Contoh memakai kamera di <Kode>192.168.1.50</Kode> port <Kode>554</Kode>,
                        dibuka di port luar <Kode>8554</Kode>. Ganti sesuai punya Anda.
                    </p>
                    <p className="font-semibold text-content">Lewat terminal — paling cepat</p>
                    {/* [contain:paint] is required, not decorative: a horizontal scroll strip without it
                        widens the whole document on a phone, and the browser answers by zooming the
                        entire page out. */}
                    <pre className="overflow-x-auto [contain:paint] rounded-control border border-edge bg-surface-sunken p-4 font-mono text-xs leading-relaxed text-content">
{`/ip firewall nat
add chain=dstnat action=dst-nat \\
    protocol=tcp dst-port=8554 \\
    in-interface=ether1-WAN \\
    src-address=${ipTampil} \\
    to-addresses=192.168.1.50 to-ports=554 \\
    comment="RTSP kamera ke server RAF"`}
                    </pre>
                    <p className="text-xs text-content-subtle">
                        <Kode>in-interface</Kode> diisi nama interface WAN Anda — lihat di <i>Interfaces</i>,
                        biasanya <Kode>ether1</Kode> atau PPPoE seperti <Kode>pppoe-out1</Kode>.
                    </p>

                    <p className="mt-2 font-semibold text-content">Lewat Winbox</p>
                    <p className="font-mono text-xs text-content">IP → Firewall → tab NAT → tombol +</p>
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        <li>Tab <b className="text-content">General</b>: Chain <Kode>dstnat</Kode>, Protocol <Kode>tcp</Kode>, Dst. Port <Kode>8554</Kode>, In. Interface = WAN Anda</li>
                        <li>Masih di General: Src. Address <Kode>{ipTampil}</Kode></li>
                        <li>Tab <b className="text-content">Action</b>: Action <Kode>dst-nat</Kode>, To Addresses <Kode>192.168.1.50</Kode>, To Ports <Kode>554</Kode></li>
                    </ul>
                    <p className="text-xs text-content-subtle">
                        Masih belum tersambung? Periksa <i>IP → Firewall → Filter Rules</i>: aturan{' '}
                        <Kode>drop</Kode> pada chain <Kode>forward</Kode> bisa memblokirnya.
                    </p>
                </Kartu>
            )}

            {caraAktif === 'ont' && (
                <Kartu judul="ONT / modem bawaan ISP">
                    <p>
                        Isinya sama saja: teruskan port dari luar ke IP kamera di dalam. Yang berbeda
                        hanya nama menunya, dan itu berubah menurut merek <i>dan</i> firmware ISP.
                    </p>
                    <div className="overflow-x-auto [contain:paint] rounded-control border border-edge">
                        <table className="w-full min-w-[440px] text-sm">
                            <thead>
                                <tr className="text-left text-xs uppercase text-content-muted">
                                    <th className="px-3 py-2">Merek</th>
                                    <th className="px-3 py-2">Menu yang biasanya dipakai</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-edge">
                                {ONT_MEREK.map((o) => (
                                    <tr key={o.merek}>
                                        <td className="px-3 py-2 text-content">{o.merek}</td>
                                        <td className="px-3 py-2">
                                            {o.menu}
                                            {o.catatan && <span className="block text-xs text-content-subtle">{o.catatan}</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <p className="mt-2 font-semibold text-content">Isian yang diminta, apa pun mereknya</p>
                    <div className="overflow-x-auto [contain:paint] rounded-control border border-edge">
                        <table className="w-full min-w-[440px] text-sm">
                            <tbody className="divide-y divide-edge">
                                {isian(ipTampil).map(([k, v]) => (
                                    <tr key={k}>
                                        <td className="px-3 py-2 text-content-muted">{k}</td>
                                        <td className="px-3 py-2 font-mono text-xs text-content">{v}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-xs text-content-subtle">Simpan, lalu sebagian ONT perlu di-reboot agar berlaku.</p>

                    <div className="mt-2 rounded-control border border-status-warn/40 bg-status-warn/10 p-3 text-xs leading-relaxed">
                        <p className="mb-2">
                            <b className="text-content">Menu forwarding tidak kelihatan?</b> Anda kemungkinan
                            masuk dengan akun <Kode>user</Kode> yang dibatasi. Menu itu hanya muncul pada
                            akun admin — mintakan ke ISP atau teknisi yang memasang.
                        </p>
                        <p>
                            <b className="text-content">Ada dua perangkat berderet?</b> Kalau ONT disambung
                            lagi ke router lain, forwarding harus dilakukan dua kali. Lebih rapi: jadikan
                            ONT mode <i>bridge</i> dan biarkan router yang memegang IP publik.
                        </p>
                    </div>
                </Kartu>
            )}

            <Kartu judul="Kalau IP publik Anda berubah-ubah">
                <p>
                    Banyak paket rumahan memberi IP publik yang berganti tiap modem menyala ulang. Itu
                    tetap bisa dipakai — pasang <b className="text-content">DDNS</b>, sebuah nama tetap
                    yang selalu menunjuk ke IP Anda sekarang. Kami mengarahkan sambungan ke nama itu,
                    jadi pergantian IP diikuti otomatis.
                </p>
                <ul className="flex list-disc flex-col gap-2 pl-5">
                    <li><b className="text-content">MikroTik</b> punya bawaan: <i>IP → Cloud → DDNS Enabled</i>, lalu salin nama <Kode>xxxxx.sn.mynetname.net</Kode></li>
                    <li><b className="text-content">ONT</b> biasanya punya menu <i>DDNS</i> untuk No-IP atau DynDNS — daftar gratis di sana lalu isikan akunnya</li>
                    <li>Kirimkan nama DDNS-nya ke kami, bukan angka IP-nya</li>
                </ul>
            </Kartu>

            <Kartu judul="Sudah selesai — lalu apa" aksen>
                <p>
                    Jangan repot menguji sendiri lewat pengecek port online: kalau Anda sudah membatasi
                    ke IP kami — dan memang seharusnya — pengecek dari luar akan melaporkan port
                    tertutup. Itu justru tanda pengaturannya benar. Biar kami yang menguji.
                </p>
                <p className="font-semibold text-content">Kirimkan ini ke kami:</p>
                <ul className="flex list-disc flex-col gap-1 pl-5">
                    <li>IP publik <b className="text-content">atau</b> nama DDNS Anda</li>
                    <li>Port luar yang dipakai (mis. <Kode>8554</Kode>)</li>
                    <li>Nama pengguna dan sandi kamera</li>
                    <li>Merek/tipe kamera, bila tahu</li>
                </ul>
                <a
                    href="https://wa.me/6289685645956?text=Halo%2C%20saya%20sudah%20setting%20forwarding%20kamera."
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex w-fit items-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110"
                >
                    Kirim lewat WhatsApp
                </a>
                <p className="text-xs text-content-subtle">
                    Kami yang mendaftarkan kameranya, menguji siarannya, dan menyiapkan halaman Anda.
                    Tidak ada biaya untuk bagian ini.
                </p>
            </Kartu>
        </div>
    );
}
