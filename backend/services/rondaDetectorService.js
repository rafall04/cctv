/**
 * Purpose: Lifecycle for the Ronda Digital motion-detector containers — list candidate cameras,
 *          create/restart/remove a detector, and locate its preview frame.
 * Caller: controllers/rondaAdminController.js.
 * Deps: node:child_process (execFile), node:fs, database/connectionPool.
 * MainFuncs: listAvailableCameras, createDetector, restartDetector, removeDetector, previewFile.
 * SideEffects: runs `docker` on the host; writes JSON under RONDA_CONFIG_DIR.
 *
 * SECURITY: every docker call goes through execFile with an argv ARRAY — never a shell string — and
 * every value that reaches it is validated first (container name, stream key, numeric ranges). That
 * combination is what keeps an admin form from turning into command execution.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { query, queryOne } from '../database/connectionPool.js';
import { getCameraDeliveryProfile, getPrimaryExternalStreamUrl } from '../utils/cameraDelivery.js';
import rondaConfigService from './rondaConfigService.js';

const run = promisify(execFile);

const CONFIG_DIR = process.env.RONDA_CONFIG_DIR || '/opt/yolo-poc/config';
const WORK_DIR = process.env.RONDA_WORK_DIR || '/opt/yolo-poc';
const IMAGE = process.env.RONDA_IMAGE || 'motion-ai:latest';
const MODEL = process.env.RONDA_MODEL || '/work/yolo11n320_openvino_model';
const RTSP_BASE = process.env.RONDA_RTSP_BASE || 'rtsp://127.0.0.1:8554';

const NAME_RE = /^motion-[a-z0-9][a-z0-9-]{0,30}$/;
const KEY_RE = /^[A-Za-z0-9-]{8,64}$/;

function fail(message, statusCode) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function assertName(name) {
    if (!NAME_RE.test(name || '')) throw fail('Nama detektor tidak valid', 400);
    return name;
}

async function docker(args) {
    try {
        const { stdout } = await run('docker', args, { timeout: 60000, maxBuffer: 1024 * 1024 });
        return stdout.trim();
    } catch (error) {
        const detail = (error.stderr || error.message || '').split('\n')[0];
        throw fail(`Perintah docker gagal: ${detail}`, 500);
    }
}

const KOLOM_SUMBER = `c.id, c.name, c.stream_key, c.stream_source, c.delivery_type,
    c.private_rtsp_url, c.external_hls_url, c.external_stream_url,
    c.external_embed_url, c.external_snapshot_url`;

/**
 * URL video yang benar-benar bisa dibaca detektor untuk sebuah kamera.
 *
 * Dulu ini selalu `rtsp://127.0.0.1:8554/<stream_key>`, seolah setiap kamera diterbitkan lewat
 * MediaMTX. Di produksi asumsi itu salah: MediaMTX berjalan dengan NOL path karena hampir semua
 * kamera di sana berjenis HLS eksternal (milik pemda). Akibatnya detektor apa pun yang
 * ditambahkan dari panel akan menyambung ulang selamanya ke alamat 404 — hidup, tapi buta.
 * Terbukti langsung saat uji pemasangan: `method DESCRIBE failed: 404 (Not Found)`, delapan kali
 * sambung ulang dalam 45 detik.
 *
 * Sumbernya kini diputuskan dengan pengelompokan yang sama seperti bagian sistem lain
 * (`utils/cameraDelivery.js`), jadi tidak ada aturan tandingan yang harus ikut dirawat.
 */
function sumberKamera(camera) {
    const profil = getCameraDeliveryProfile(camera);

    if (profil.hasInternalRtsp) {
        if (!KEY_RE.test(String(camera.stream_key || ''))) {
            return { url: null, jenis: 'internal_hls', alasan: 'Kamera ini belum punya stream key yang valid' };
        }
        return { url: `${RTSP_BASE}/${camera.stream_key}`, jenis: 'internal_hls' };
    }

    if (profil.effectiveDeliveryType === 'external_hls') {
        const url = getPrimaryExternalStreamUrl(camera);
        if (url) return { url, jenis: 'external_hls' };
    }

    // Sisanya (embed, mjpeg, jsmpeg, websocket, external_unresolved) memang tidak menyediakan
    // aliran video yang bisa dibuka ffmpeg/opencv. Menolak di sini jauh lebih baik daripada
    // membiarkan operator menambah kamera yang tak akan pernah melihat apa pun.
    return {
        url: null,
        jenis: profil.classification,
        alasan: `Jenis siaran "${profil.classification}" belum bisa dipantau ronda — `
            + 'yang didukung baru kamera RTSP internal dan HLS eksternal',
    };
}

function slugFor(cameraName, taken) {
    const base = String(cameraName || 'cam')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24) || 'cam';
    let candidate = `motion-${base}`;
    let n = 2;
    while (taken.has(candidate)) candidate = `motion-${base}-${n++}`;
    return candidate;
}

/**
 * The detectors need the Telegram bot token at container-creation time. Prefer a sibling's stored
 * value, then the environment, then `settings.telegram_config` — the same record the Node
 * telegramService reads, so a new detector uses the bot the rest of the system already uses. Without
 * this fallback a camera added from the UI would run but never send an alert.
 */
function resolveBotToken() {
    const fromConfig = rondaConfigService.anyBotToken();
    if (fromConfig) return fromConfig;
    try {
        const row = queryOne("SELECT value FROM settings WHERE key = 'telegram_config'");
        if (row?.value) return JSON.parse(row.value).botToken || '';
    } catch (error) {
        console.error('Ronda bot token lookup error:', error);
    }
    return '';
}

/*
 * Kesiapan dijawab dari cache pendek: pemeriksaannya memanggil `docker image inspect`, dan
 * halaman daftar dimuat ulang tiap kali admin membuka tab. Tanpa cache, satu halaman admin
 * bisa memicu belasan proses docker di server yang beban CPU-nya sudah tinggi.
 */
const KESIAPAN_TTL = 30000;
let kesiapanCache = { pada: 0, hasil: null };

class RondaDetectorService {
    async #imageAda() {
        try {
            return Boolean(await docker(['image', 'inspect', IMAGE, '-f', '{{.Id}}']));
        } catch {
            return false;
        }
    }

    /**
     * Apa saja yang belum ada supaya "Tambah Kamera" benar-benar bisa jalan.
     *
     * Ini ada karena kegagalannya dulu menyesatkan: tanpa runtime detektor, tombol tambah
     * berhenti di pesan "Token bot Telegram belum tersetel" — seolah tinggal mengisi token,
     * padahal image docker dan modelnya pun tidak ada di mesin ini. Operator berhak tahu
     * daftar persisnya, bukan menebak dari satu pesan galat.
     */
    async kesiapan() {
        const sekarang = Date.now();
        if (kesiapanCache.hasil && sekarang - kesiapanCache.pada < KESIAPAN_TTL) {
            return kesiapanCache.hasil;
        }

        const rincian = {
            docker: false,
            image: false,
            work_dir: fs.existsSync(WORK_DIR),
            model: fs.existsSync(path.join(WORK_DIR, String(MODEL).replace(/^\/work\//, ''))),
            config_dir: rondaConfigService.isAvailable(),
            telegram_token: Boolean(resolveBotToken()),
        };
        try {
            await run('docker', ['version', '-f', '{{.Server.Version}}'], { timeout: 10000 });
            rincian.docker = true;
        } catch {
            rincian.docker = false;
        }
        if (rincian.docker) rincian.image = await this.#imageAda();

        const label = {
            docker: 'Docker aktif di server',
            image: `Image docker ${IMAGE}`,
            work_dir: `Folder kerja ${WORK_DIR}`,
            model: `Model deteksi ${MODEL}`,
            config_dir: `Folder setelan ${CONFIG_DIR}`,
        };
        /*
         * Token Telegram sengaja DILUAR penentu `siap`. Ia bukan bagian yang dipasang, melainkan
         * setelan yang hanya boleh diisi manusia — dan kalau ia ikut mengunci `siap`, tombol
         * "Tambah Kamera" tetap tersembunyi setelah runtime terpasang, sehingga operator tidak
         * punya jalan untuk maju. Kekurangannya tetap dilaporkan, hanya lewat jalur berbeda.
         */
        const hasil = {
            siap: Object.entries(rincian)
                .filter(([k]) => k !== 'telegram_token')
                .every(([, ada]) => ada),
            kurang: Object.entries(label).filter(([k]) => !rincian[k]).map(([, teks]) => teks),
            perlu_disetel: rincian.telegram_token
                ? []
                : ['Token bot Telegram — isi di Pengaturan Telegram sebelum menambah kamera'],
            rincian,
        };
        kesiapanCache = { pada: sekarang, hasil };
        return hasil;
    }

    /** Community cameras that have a stream key and no detector yet. */
    listAvailableCameras() {
        const monitored = new Set(
            rondaConfigService.listRaw().map((c) => String(c.config?.stream_key || '')).filter(Boolean),
        );
        const rows = query(
            `SELECT ${KOLOM_SUMBER}, a.name AS area
             FROM cameras c LEFT JOIN areas a ON a.id = c.area_id
             WHERE c.stream_key IS NOT NULL AND c.stream_key != '' AND c.camera_class = 'community'
             ORDER BY c.name`,
        );
        // Kamera yang sumbernya tidak bisa dibaca tidak ditawarkan sama sekali: menawarkannya
        // hanya memindahkan kegagalan ke tempat yang lebih membingungkan — kamera yang sudah
        // terlanjur ditambahkan, diam, dan tampak seperti detektor rusak.
        return rows
            .filter((r) => !monitored.has(String(r.stream_key)))
            .filter((r) => Boolean(sumberKamera(r).url))
            .map((r) => ({ id: r.id, name: r.name, area: r.area || '', stream_key: r.stream_key }));
    }

    /** Build the docker argv for a detector from its stored settings. */
    #runArgs(name, cfg) {
        const env = (k, v) => ['-e', `${k}=${v}`];
        return [
            'run', '-d', '--name', name, '--restart', 'unless-stopped', '--network', 'host',
            '--cpus', String(cfg.cpus || 2), '--memory', `${cfg.memory_mb || 2048}m`,
            ...env('TZ', 'Asia/Jakarta'),
            // `source_url` diisi saat kamera dibuat; cadangan lama dipertahankan supaya config
            // yang ditulis sebelum resolusi sumber ada tetap bisa dinyalakan ulang.
            ...env('RTSP_URL', cfg.source_url || `${RTSP_BASE}/${cfg.stream_key}`),
            ...env('CAM_LABEL', cfg.label || name),
            ...env('AREA_LABEL', cfg.area || '-'),
            ...env('OUT_DIR', cfg.out_dir),
            ...env('CONFIG_PATH', `/work/config/${name}.json`),
            ...env('CONFIG_EVERY', '15'),
            ...env('PROC_W', String(cfg.proc_w || 960)),
            ...env('TARGET_FPS', String(cfg.target_fps || 5)),
            ...env('VAR_THRESH', '50'),
            ...env('MIN_AREA', String(cfg.min_area || 700)),
            ...env('CONFIRM', '2.5'),
            ...env('DEBOUNCE', '3'),
            ...env('DETECT_SHADOW', '1'),
            ...env('GLOBAL_FRAC', '0.6'),
            ...env('IGNORE_ZONES', JSON.stringify(cfg.ignore || [])),
            ...env('ROI_JSON', JSON.stringify(cfg.roi || [])),
            ...env('CROP_LIMIT', cfg.crop_limit || '0,0,1,1'),
            ...env('CONFIRM_MODEL', MODEL),
            ...env('CONFIRM_CONF', String(cfg.confirm_conf ?? 0.15)),
            ...env('CONFIRM_IMGSZ', '320'),
            ...env('CONFIRM_CLASSES', cfg.confirm_classes || 'person,bicycle,car,motorcycle,bus,truck'),
            ...env('GATE_COOLDOWN', '10'),
            ...env('GATE_CROP', '0.55'),
            ...env('RETENTION_DAYS', String(cfg.retention_days || 7)),
            ...env('MAX_SNAPS', String(cfg.max_snaps || 50)),
            ...env('MAX_EVENTS', '20000'),
            ...env('TELEGRAM_BOT_TOKEN', cfg.bot_token || ''),
            ...env('TELEGRAM_CHAT_ID', cfg.chat_id || ''),
            ...env('TG_COOLDOWN', String(cfg.tg_cooldown ?? 12)),
            ...env('ALERT_HOURS', cfg.alert_hours || ''),
            ...env('TG_COOLDOWN_OFF', String(cfg.tg_cooldown_off ?? 300)),
            ...env('TG_TEST', '0'),
            '-v', `${WORK_DIR}:/work`, '-w', '/work', IMAGE, 'python', 'motion.py',
        ];
    }

    async createDetector(input) {
        const { camera_id: cameraId, area, chat_id: chatId } = input || {};
        const row = query(`SELECT ${KOLOM_SUMBER} FROM cameras c WHERE c.id = ?`, [cameraId])[0];
        if (!row) throw fail('Kamera tidak ditemukan', 404);
        if (!KEY_RE.test(String(row.stream_key || ''))) throw fail('Kamera ini belum punya stream key yang valid', 400);

        const sumber = sumberKamera(row);
        if (!sumber.url) throw fail(sumber.alasan || 'Sumber kamera ini tidak bisa dipantau', 400);

        const taken = new Set(rondaConfigService.listNames());
        const name = assertName(slugFor(row.name, taken));

        const cfg = {
            label: input.label?.trim() || row.name,
            area: String(area || '').trim(),
            stream_key: row.stream_key,
            source_url: sumber.url,
            source_type: sumber.jenis,
            camera_id: row.id,
            out_dir: `/work/live/${name}`,
            enabled: true,
            alert_hours: input.alert_hours || '21:00-05:00',
            tg_cooldown: Number(input.tg_cooldown) || 12,
            tg_cooldown_off: Number(input.tg_cooldown_off ?? 300),
            chat_id: String(chatId || '').trim(),
            min_area: Number(input.min_area) || 700,
            confirm_conf: 0.15,
            confirm_classes: input.confirm_classes || 'person,bicycle,car,motorcycle,bus,truck',
            proc_w: Number(input.proc_w) || 960,
            target_fps: Number(input.target_fps) || 5,
            cpus: 2,
            memory_mb: 2048,
            ignore: [],
            roi: [],
            crop_limit: '0,0,1,1',
            retention_days: 7,
            max_snaps: 50,
            // Shared secret, resolved server-side so it is never typed into (or returned to) the browser.
            bot_token: resolveBotToken(),
        };
        if (!cfg.bot_token) {
            throw fail('Token bot Telegram belum tersetel di Pengaturan Telegram, jadi kamera baru tidak bisa mengirim peringatan', 400);
        }

        fs.mkdirSync(path.join(WORK_DIR, 'live', name, 'snaps'), { recursive: true });
        rondaConfigService.writeRaw(name, cfg);
        try {
            await docker(this.#runArgs(name, cfg));
        } catch (error) {
            rondaConfigService.deleteRaw(name);           // don't leave a config for a container that never started
            throw error;
        }
        return rondaConfigService.getCamera(name);
    }

    /**
     * Detectors created before this admin page existed were configured entirely through container
     * env vars, so their JSON has no stream key or token. Recover both from the running container
     * before it is destroyed — otherwise a restart would rebuild them with a broken RTSP URL and no
     * Telegram credentials.
     */
    async #healConfig(name, config) {
        if (config.stream_key && config.bot_token && config.source_url) return config;
        let env = [];
        try {
            env = JSON.parse(await docker(['inspect', '-f', '{{json .Config.Env}}', name]) || '[]');
        } catch {
            env = [];
        }
        const pick = (key) => {
            const hit = env.find((e) => e.startsWith(`${key}=`));
            return hit ? hit.slice(key.length + 1) : '';
        };
        const healed = { ...config };
        const rtsp = pick('RTSP_URL');
        if (!healed.stream_key) {
            const key = rtsp.split('/').pop() || '';
            if (KEY_RE.test(key)) healed.stream_key = key;
        }
        /*
         * Sumber dipulihkan dari DB lebih dulu, bukan dari env container: kamera eksternal bisa
         * berganti URL, dan container lama menyimpan alamat yang sudah basi. Env hanya dipakai
         * kalau kameranya sudah tidak ada lagi di database.
         */
        if (!healed.source_url) {
            const baris = healed.camera_id
                ? query(`SELECT ${KOLOM_SUMBER} FROM cameras c WHERE c.id = ?`, [healed.camera_id])[0]
                : null;
            const dariDb = baris ? sumberKamera(baris) : { url: null };
            healed.source_url = dariDb.url || rtsp || '';
            if (dariDb.jenis) healed.source_type = dariDb.jenis;
        }
        if (!healed.bot_token) healed.bot_token = pick('TELEGRAM_BOT_TOKEN') || resolveBotToken();
        if (!healed.out_dir) healed.out_dir = pick('OUT_DIR') || `/work/live/${name}`;
        if (!healed.stream_key || !healed.source_url) {
            throw fail('Sumber kamera tidak diketahui, jadi belum bisa dinyalakan ulang dari sini', 400);
        }
        rondaConfigService.writeRaw(name, healed);
        return healed;
    }

    /** Recreate the container so structural settings (source, resolution, fps) take effect. */
    async restartDetector(name) {
        assertName(name);
        const config = await this.#healConfig(name, rondaConfigService.getRaw(name));
        await docker(['rm', '-f', name]).catch(() => {});
        await docker(this.#runArgs(name, config));
        return rondaConfigService.getCamera(name);
    }

    async removeDetector(name) {
        assertName(name);
        rondaConfigService.getRaw(name);                  // 404s if unknown
        await docker(['rm', '-f', name]).catch(() => {});
        rondaConfigService.deleteRaw(name);
        return { name, removed: true };
    }

    /** Latest annotated frame — used by the admin page to show masks/zones as the detector sees them. */
    previewFile(name) {
        assertName(name);
        const config = rondaConfigService.getRaw(name);
        const file = path.join(String(config.out_dir || '').replace(/^\/work/, WORK_DIR), 'latest.jpg');
        if (!fs.existsSync(file)) throw fail('Belum ada gambar dari kamera ini', 404);
        return file;
    }
}

export default new RondaDetectorService();
