/*
 * Purpose: One camera's settings card on the Ronda Digital admin page — status light, pending-restart
 *          banner, live zone editor, and every per-camera field (alert window, Telegram group,
 *          cooldowns, classes, sensitivity, and the advanced structural knobs behind a disclosure).
 * Caller: pages/RondaSettings.jsx (rendered per camera).
 * Deps: RondaZoneEditor, rondaFormKit (shared constants + pure helpers).
 * MainFuncs: RondaCameraCard.
 * SideEffects: none — all state lives in the parent; this component only calls the on* callbacks.
 */

import RondaZoneEditor from './RondaZoneEditor';
import {
    HOUR_PRESETS,
    CLASS_PRESETS,
    PERF_PRESETS,
    inputClass,
    labelClass,
    hintClass,
    btnGhost,
    matchPreset,
    dirtyStructuralKeys,
    safeZones,
    draftFrom,
} from './rondaFormKit';

export default function RondaCameraCard({
    cam,
    draft: draftProp,
    busy,
    pending,
    previewKey,
    onField,
    onFields,
    onSave,
    onRestart,
    onRemove,
}) {
    const draft = draftProp || draftFrom(cam.config);
    // Kunci struktural yang diubah tapi belum disimpan → beri tahu operator bahwa Simpan
    // saja belum cukup, masih perlu nyala ulang setelahnya.
    const dirtyStruct = dirtyStructuralKeys(draft, cam.config);
    const online = cam.status?.online;
    // Detektor yang hidup tetapi tidak mendapat gambar bukan "aktif" dan bukan pula
    // "mati" — menyamakannya dengan salah satu dari keduanya menyembunyikan justru
    // kegagalan yang paling sering: alamat sumber yang tidak bisa dibuka.
    const butaSumber = online && cam.status?.sourceOk === false;
    const warnaTitik = butaSumber ? 'bg-status-warn' : (online ? 'bg-status-live' : 'bg-status-fault');
    const restarting = busy === `restart-${cam.name}`;
    const restartDisabled = restarting || busy === 'restart-all';

    return (
        <section className="rounded-card border border-edge bg-surface-raised p-4 shadow-e1">
            <div className="flex flex-wrap items-center gap-2">
                <span className={`h-2.5 w-2.5 flex-none rounded-full ${warnaTitik}`} aria-hidden="true" />
                <h2 className="font-semibold text-content">{cam.config?.label || cam.name}</h2>
                <span className="text-xs tabular-nums text-content-subtle">
                    {cam.config?.area ? `${cam.config.area} · ` : ''}
                    {butaSumber
                        ? `berjalan, tetapi gambar kamera tidak terbaca — ${cam.status.reconnects ?? 0}× menyambung ulang`
                        : (online ? `aktif · ${cam.status.eventsToday ?? 0} kejadian hari ini` : 'tidak aktif')}
                </span>
                <span className="ml-auto flex gap-2">
                    <button
                        type="button"
                        className={btnGhost}
                        disabled={restartDisabled}
                        onClick={() => onRestart(cam.name)}
                    >
                        {restarting ? 'Menyalakan…' : 'Nyalakan ulang'}
                    </button>
                    <button
                        type="button"
                        className={`${btnGhost} text-status-fault`}
                        disabled={busy === `del-${cam.name}`}
                        onClick={() => onRemove(cam.name, cam.config?.label || cam.name)}
                    >
                        Hapus
                    </button>
                </span>
            </div>

            {pending && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-control border border-status-warn/40
                                bg-status-warn/10 px-3 py-2">
                    <span className="min-w-0 flex-1 text-xs text-status-warn">
                        Setelan lanjutan tersimpan, tetapi belum berlaku sampai kamera dinyalakan ulang.
                    </span>
                    <button
                        type="button"
                        className="min-h-[36px] flex-none rounded-control bg-status-warn px-3 py-1.5 text-xs
                                   font-semibold text-white disabled:opacity-60 focus:outline-none
                                   focus-visible:ring-2 focus-visible:ring-status-warn"
                        disabled={restartDisabled}
                        onClick={() => onRestart(cam.name)}
                    >
                        {restarting ? 'Menyalakan…' : 'Nyalakan ulang sekarang'}
                    </button>
                </div>
            )}

            <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
                <div>
                    <RondaZoneEditor
                        name={cam.name}
                        refreshKey={previewKey}
                        {...safeZones(draft)}
                        onChange={({ roi, ignore }) => {
                            onField(cam.name, 'roi', JSON.stringify(roi));
                            onField(cam.name, 'ignore', JSON.stringify(ignore));
                        }}
                    />
                    <p className={hintClass}>
                        Merah = zona diabaikan · Kuning = area pantau. Tekan Simpan setelah mengubah.
                    </p>
                </div>

                <div>
                    <label className="flex items-center gap-2 text-sm text-content">
                        <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(e) => onField(cam.name, 'enabled', e.target.checked)}
                            className="h-5 w-5 rounded border-edge accent-[var(--primary-color)] sm:h-4 sm:w-4"
                        />
                        Kirim peringatan ke Telegram
                    </label>

                    <label className="mt-2 flex items-center gap-2 text-sm text-content">
                        <input
                            type="checkbox"
                            checked={!!draft.stamp}
                            onChange={(e) => onField(cam.name, 'stamp', e.target.checked)}
                            className="h-5 w-5 rounded border-edge accent-[var(--primary-color)] sm:h-4 sm:w-4"
                        />
                        Cap waktu (jam) di gambar
                    </label>
                    <p className={hintClass}>
                        Mati = tanpa jam hijau di kiri (kamera sudah sinkron NTP). Berlaku ~15 detik setelah Simpan, tanpa restart.
                    </p>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                            <label className={labelClass} htmlFor={`hours-${cam.name}`}>
                                Jam ronda (siaga penuh)
                            </label>
                            <input
                                id={`hours-${cam.name}`}
                                className={inputClass}
                                value={draft.alert_hours}
                                placeholder="21:00-05:00"
                                onChange={(e) => onField(cam.name, 'alert_hours', e.target.value)}
                            />
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {HOUR_PRESETS.map((p) => (
                                    <button
                                        key={p.label}
                                        type="button"
                                        onClick={() => onField(cam.name, 'alert_hours', p.value)}
                                        className="min-h-[40px] rounded-control border border-edge px-3 py-1 text-[11px]
                                                   text-content-muted hover:border-edge-strong focus:outline-none
                                                   focus-visible:ring-2 focus-visible:ring-primary-500 sm:min-h-0 sm:px-2"
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                            <p className={hintClass}>Di luar jam ini peringatan tetap dikirim, hanya lebih jarang.</p>
                        </div>

                        <div>
                            <label className={labelClass} htmlFor={`cd-${cam.name}`}>Jeda saat ronda (detik)</label>
                            <input id={`cd-${cam.name}`} type="number" min="5" max="3600" className={inputClass}
                                value={draft.tg_cooldown}
                                onChange={(e) => onField(cam.name, 'tg_cooldown', Number(e.target.value))} />
                        </div>
                        <div>
                            <label className={labelClass} htmlFor={`cdoff-${cam.name}`}>Jeda di luar ronda (detik)</label>
                            <input id={`cdoff-${cam.name}`} type="number" min="0" max="86400" className={inputClass}
                                value={draft.tg_cooldown_off}
                                onChange={(e) => onField(cam.name, 'tg_cooldown_off', Number(e.target.value))} />
                            <p className={hintClass}>0 = matikan di luar jam ronda.</p>
                        </div>

                        <div className="sm:col-span-2">
                            <label className={labelClass} htmlFor={`chat-${cam.name}`}>ID grup Telegram</label>
                            <input id={`chat-${cam.name}`} className={inputClass} value={draft.chat_id}
                                placeholder="-1001234567890"
                                onChange={(e) => onField(cam.name, 'chat_id', e.target.value)} />
                        </div>

                        <div>
                            <label className={labelClass} htmlFor={`cls-${cam.name}`}>Objek yang dilaporkan</label>
                            <select id={`cls-${cam.name}`} className={inputClass} value={draft.confirm_classes}
                                onChange={(e) => onField(cam.name, 'confirm_classes', e.target.value)}>
                                {CLASS_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                            </select>
                            <p className={hintClass}>Area parkir sebaiknya &quot;Orang saja&quot;.</p>
                        </div>
                        <div>
                            <label className={labelClass} htmlFor={`area-${cam.name}`}>Ukuran gerakan minimum</label>
                            <input id={`area-${cam.name}`} type="number" min="100" max="200000" step="100"
                                className={inputClass} value={draft.min_area}
                                onChange={(e) => onField(cam.name, 'min_area', Number(e.target.value))} />
                            <p className={hintClass}>Naikkan bila bayangan daun memicu peringatan.</p>
                        </div>
                    </div>

                    <details className="mt-4 rounded-control border border-edge bg-surface-sunken p-3">
                        <summary className="cursor-pointer text-sm font-medium text-content">
                            Pengaturan lanjutan
                        </summary>

                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div>
                                <label className={labelClass} htmlFor={`lbl-${cam.name}`}>Nama tampil</label>
                                <input id={`lbl-${cam.name}`} className={inputClass} value={draft.label}
                                    onChange={(e) => onField(cam.name, 'label', e.target.value)} />
                            </div>
                            <div>
                                <label className={labelClass} htmlFor={`ar-${cam.name}`}>Nama area</label>
                                <input id={`ar-${cam.name}`} className={inputClass} value={draft.area}
                                    onChange={(e) => onField(cam.name, 'area', e.target.value)} />
                            </div>

                            <div className="sm:col-span-2">
                                <label className={labelClass} htmlFor={`ign-${cam.name}`}>
                                    Zona abaikan — jam/watermark/jalan tetangga
                                </label>
                                <textarea id={`ign-${cam.name}`} rows="2" className={`${inputClass} font-mono text-base sm:text-xs`}
                                    value={draft.ignore}
                                    onChange={(e) => onField(cam.name, 'ignore', e.target.value)} />
                                <p className={hintClass}>
                                    Daftar kotak [x1,y1,x2,y2] dalam proporsi 0–1. Contoh: [[0,0,0.3,0.1]]
                                </p>
                            </div>
                            <div className="sm:col-span-2">
                                <label className={labelClass} htmlFor={`roi-${cam.name}`}>
                                    Area pantau — kosongkan berarti seluruh gambar
                                </label>
                                <textarea id={`roi-${cam.name}`} rows="2" className={`${inputClass} font-mono text-base sm:text-xs`}
                                    value={draft.roi}
                                    onChange={(e) => onField(cam.name, 'roi', e.target.value)} />
                                <p className={hintClass}>
                                    Titik-titik [x,y] membentuk poligon. Berguna bila batas lahan miring.
                                </p>
                            </div>

                            <div className="sm:col-span-2">
                                <label className={labelClass}>Preset performa</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {PERF_PRESETS.map((p) => {
                                        const aktif = matchPreset(draft) === p.key;
                                        return (
                                            <button
                                                key={p.key}
                                                type="button"
                                                aria-pressed={aktif}
                                                onClick={() => onFields(cam.name, {
                                                    proc_w: p.proc_w,
                                                    target_fps: p.target_fps,
                                                })}
                                                className={`min-h-[40px] rounded-control border px-3 py-1 text-[11px]
                                                           focus:outline-none focus-visible:ring-2
                                                           focus-visible:ring-primary-500 sm:min-h-0 ${
                                                    aktif
                                                        ? 'border-primary-500 bg-primary-500/10 font-semibold text-content'
                                                        : 'border-edge text-content-muted hover:border-edge-strong'
                                                }`}
                                            >
                                                {p.label}
                                                <span className="ml-1 tabular-nums text-content-subtle">
                                                    {p.proc_w}·{p.target_fps}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className={hintClass}>
                                    {PERF_PRESETS.find((p) => p.key === matchPreset(draft))?.hint
                                        || 'Nilai khusus. Kedua tuas di bawah bisa disetel manual.'}
                                    {' '}Perlu nyalakan ulang setelah disimpan.
                                </p>
                            </div>

                            <div>
                                <label className={labelClass} htmlFor={`pw-${cam.name}`}>
                                    Lebar proses (piksel)
                                </label>
                                <input id={`pw-${cam.name}`} type="number" min="320" max="1920" step="64"
                                    className={inputClass} value={draft.proc_w}
                                    onChange={(e) => onField(cam.name, 'proc_w', Number(e.target.value))} />
                                <p className={hintClass}>Turunkan untuk hemat CPU · perlu nyalakan ulang.</p>
                            </div>
                            <div>
                                <label className={labelClass} htmlFor={`fps-${cam.name}`}>Laju proses (fps)</label>
                                <input id={`fps-${cam.name}`} type="number" min="1" max="25"
                                    className={inputClass} value={draft.target_fps}
                                    onChange={(e) => onField(cam.name, 'target_fps', Number(e.target.value))} />
                                <p className={hintClass}>Tuas CPU terbesar · perlu nyalakan ulang.</p>
                            </div>

                            <div>
                                <label className={labelClass} htmlFor={`crop-${cam.name}`}>Batas bingkai foto</label>
                                <input id={`crop-${cam.name}`} className={inputClass} value={draft.crop_limit}
                                    placeholder="0,0,1,1"
                                    onChange={(e) => onField(cam.name, 'crop_limit', e.target.value)} />
                                <p className={hintClass}>Agar jalan tetangga tidak masuk foto · perlu nyalakan ulang.</p>
                            </div>
                            <div>
                                <label className={labelClass} htmlFor={`conf-${cam.name}`}>Ambang keyakinan AI</label>
                                <input id={`conf-${cam.name}`} type="number" min="0.05" max="0.9" step="0.05"
                                    className={inputClass} value={draft.confirm_conf}
                                    onChange={(e) => onField(cam.name, 'confirm_conf', Number(e.target.value))} />
                                <p className={hintClass}>Turunkan bila orang nyata sering terlewat.</p>
                            </div>

                            <div>
                                <label className={labelClass} htmlFor={`ret-${cam.name}`}>Simpan foto (hari)</label>
                                <input id={`ret-${cam.name}`} type="number" min="1" max="90"
                                    className={inputClass} value={draft.retention_days}
                                    onChange={(e) => onField(cam.name, 'retention_days', Number(e.target.value))} />
                            </div>
                            <div>
                                <label className={labelClass} htmlFor={`snap-${cam.name}`}>Maks foto tersimpan</label>
                                <input id={`snap-${cam.name}`} type="number" min="5" max="5000"
                                    className={inputClass} value={draft.max_snaps}
                                    onChange={(e) => onField(cam.name, 'max_snaps', Number(e.target.value))} />
                            </div>
                        </div>
                    </details>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={() => onSave(cam.name)}
                            disabled={busy === cam.name}
                            className="w-full rounded-control bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white
                                       disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:w-auto"
                        >
                            {busy === cam.name ? 'Menyimpan…' : 'Simpan'}
                        </button>
                        {dirtyStruct.length > 0 && (
                            <span className="text-[11px] text-status-warn">
                                Ada perubahan lanjutan yang perlu nyala ulang setelah disimpan.
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}
