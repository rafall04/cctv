/*
 * Purpose: Native SIREN control via IMOU Cloud — the camera's built-in active-deterrence siren is far
 *   louder than the ONVIF two-way-talk backchannel. One-time setup: IMOU OpenAPI app credentials
 *   (appId/appSecret from open.imoulife.com) + map each camera to its IMOU device SN; then a per-camera
 *   Siren ON/OFF. Firing is confirmed (it's loud) and cloud-routed.
 * Caller: pages/AudioBroadcast.jsx (Panel tab, under the emergency bar).
 * Deps: audioService (imou config/devices/siren), contexts, components/ui.
 * MainFuncs: SirenControl.
 * SideEffects: saves IMOU creds/SN; fires the physical camera siren.
 *
 * SN mapping WITHOUT hunting for the sticker: the device list is pulled from the IMOU cloud (deviceBaseList)
 * and auto-loaded once creds are set. Each camera's SN is a DROPDOWN of those devices, and "Cocokkan otomatis"
 * pre-fills unmapped cameras by name similarity for the operator to review + save — no typing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getImouConfig, setImouConfig, testImou, getImouDevices, setCameraImouSn, cameraSiren, getActiveSirens, stopAllSirens } from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { Button, Field } from '../../ui';

// Normalise a name for fuzzy matching: lowercase, strip everything but a-z0-9.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Best IMOU device whose name matches a camera name (exact, or one contains the other, len>=3). null if none.
function matchDeviceSn(camName, devices) {
    const c = norm(camName);
    if (!c || !Array.isArray(devices)) return null;
    let best = null; let bestLen = 0;
    for (const d of devices) {
        const n = norm(d.name);
        if (!n) continue;
        if (n === c) return d.sn;
        if ((c.includes(n) || n.includes(c)) && n.length >= 3 && n.length > bestLen) { best = d; bestLen = n.length; }
    }
    return best ? best.sn : null;
}

export default function SirenControl() {
    const [cfg, setCfg] = useState(null);
    const [appId, setAppId] = useState('');
    const [appSecret, setAppSecret] = useState('');
    const [devices, setDevices] = useState(null);
    const [busy, setBusy] = useState(null);
    const [snEdits, setSnEdits] = useState({}); // camId -> pending SN (unsaved)
    const [activeSirens, setActiveSirens] = useState([]);
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    const load = useCallback(async () => {
        const r = await getImouConfig();
        if (r.success) setCfg(r.data);
    }, []);
    useEffect(() => { load(); }, [load]);

    // Poll which sirens are currently ON so the operator always sees a live one and can silence it.
    const loadSirens = useCallback(async () => {
        const r = await getActiveSirens();
        if (r.success) setActiveSirens(r.data || []);
    }, []);
    useEffect(() => {
        if (!cfg?.configured) return undefined;
        loadSirens();
        const t = setInterval(loadSirens, 8000);
        return () => clearInterval(t);
    }, [cfg, loadSirens]);

    const silenceAll = async () => {
        const r = await stopAllSirens();
        if (r.success) { showNotification({ type: 'success', title: r.message || 'Sirene dimatikan' }); loadSirens(); }
        else showNotification({ type: 'error', title: 'Gagal', message: r.message });
    };

    // Auto-match unmapped cameras against the loaded device list (pending edits, not saved).
    const autoMatch = useCallback((devs, cams) => {
        if (!Array.isArray(devs) || !Array.isArray(cams)) return 0;
        let n = 0;
        setSnEdits((prev) => {
            const next = { ...prev };
            for (const cam of cams) {
                if (cam.imou_sn || next[cam.id]) continue; // already mapped or already pending
                const sn = matchDeviceSn(cam.name, devs);
                if (sn) { next[cam.id] = sn; n += 1; }
            }
            return next;
        });
        return n;
    }, []);

    const loadDevices = useCallback(async (auto = false) => {
        setBusy('dev');
        const r = await getImouDevices();
        setBusy(null);
        if (!r.success) { if (!auto) showNotification({ type: 'error', title: 'Gagal', message: r.message }); return; }
        const list = r.data || [];
        setDevices(list);
        const matched = autoMatch(list, cfg?.cameras || []);
        if (matched > 0) showNotification({ type: 'success', title: `${matched} kamera dicocokkan otomatis`, message: 'Periksa lalu simpan.' });
    }, [autoMatch, cfg, showNotification]);

    // Pull the device list automatically once creds are configured — the operator shouldn't have to click.
    useEffect(() => { if (cfg?.configured && devices === null) loadDevices(true); }, [cfg, devices, loadDevices]);

    const saveCreds = async () => {
        setBusy('creds');
        const r = await setImouConfig({ appId: appId.trim(), appSecret: appSecret.trim() });
        setBusy(null);
        if (!r.success) { showNotification({ type: 'error', title: 'Gagal', message: r.message }); return; }
        setAppSecret('');
        showNotification({ type: 'success', title: 'Kredensial IMOU disimpan' });
        load();
    };
    const test = async () => {
        setBusy('test');
        const r = await testImou();
        setBusy(null);
        showNotification({ type: r.success ? 'success' : 'error', title: r.success ? 'Koneksi IMOU OK' : 'Gagal', message: r.message });
    };
    const saveSn = async (cam) => {
        const sn = (snEdits[cam.id] ?? cam.imou_sn ?? '').trim();
        setBusy(`sn-${cam.id}`);
        const r = await setCameraImouSn(cam.id, sn);
        setBusy(null);
        if (r.success) {
            setSnEdits((s) => { const n = { ...s }; delete n[cam.id]; return n; });
            showNotification({ type: 'success', title: 'SN disimpan', message: cam.name });
            load();
        } else showNotification({ type: 'error', title: 'Gagal', message: r.message });
    };
    const saveAllPending = async () => {
        const cams = (cfg?.cameras || []).filter((c) => snEdits[c.id] !== undefined && snEdits[c.id] !== (c.imou_sn || ''));
        if (cams.length === 0) return;
        setBusy('save-all');
        let ok = 0;
        for (const cam of cams) {
            const r = await setCameraImouSn(cam.id, (snEdits[cam.id] || '').trim());
            if (r.success) ok += 1;
        }
        setBusy(null);
        setSnEdits({});
        showNotification({ type: ok ? 'success' : 'error', title: `${ok}/${cams.length} SN disimpan` });
        load();
    };
    const siren = async (cam, on) => {
        if (on) {
            const ok = await confirm({ title: '🔊 Nyalakan sirene?', message: `Sirene fisik "${cam.name}" akan BERBUNYI KERAS. Lanjut?`, confirmLabel: 'Nyalakan', cancelLabel: 'Batal', tone: 'danger' });
            if (!ok) return;
        }
        setBusy(`siren-${cam.id}`);
        const r = await cameraSiren(cam.id, on);
        setBusy(null);
        showNotification({ type: r.success ? (on ? 'warning' : 'success') : 'error', title: r.success ? (on ? 'Sirene menyala' : 'Sirene mati') : 'Gagal', message: r.message });
        loadSirens();
    };

    const pendingCount = useMemo(
        () => (cfg?.cameras || []).filter((c) => snEdits[c.id] !== undefined && snEdits[c.id] !== (c.imou_sn || '')).length,
        [cfg, snEdits],
    );

    if (!cfg) return null;

    return (
        <section className="space-y-3 rounded-card border border-edge bg-surface p-4 shadow-e1">
            <div>
                <h3 className="text-sm font-semibold text-content">🔊 Sirene native (IMOU Cloud)</h3>
                <p className="mt-0.5 text-xs text-content-muted">Sirene bawaan kamera — jauh lebih keras dari jalur suara biasa. Lewat cloud IMOU (butuh internet + kamera ter-bind di IMOU Life). Kredensial juga bisa diatur di Pengaturan → Integrasi & Kunci API. Sirene mati otomatis setelah beberapa saat sebagai pengaman.</p>
            </div>

            {activeSirens.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border-2 border-status-fault bg-status-fault/10 px-3 py-2">
                    <span className="text-sm font-bold text-status-fault">🔊 {activeSirens.length} sirene MENYALA: {activeSirens.map((s) => s.name).join(', ')}</span>
                    <button type="button" onClick={silenceAll} className="shrink-0 rounded-control border-2 border-status-fault bg-surface px-3 py-1.5 text-sm font-bold text-status-fault hover:bg-status-fault/20">🔇 Matikan semua sirene</button>
                </div>
            )}

            {/* Credentials */}
            {!cfg.configured ? (
                <div className="space-y-2 rounded-control border border-edge bg-surface-sunken p-3">
                    <p className="text-xs text-content-muted">Daftar app di <span className="font-medium">open.imoulife.com</span> → salin appId &amp; appSecret ke sini.</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Field label="appId" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="lc..." />
                        <Field label="appSecret" type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="••••••" />
                    </div>
                    <Button variant="primary" loading={busy === 'creds'} disabled={!appId.trim() || !appSecret.trim()} onClick={saveCreds}>Simpan kredensial</Button>
                </div>
            ) : (
                <div className="flex flex-wrap items-center gap-2 rounded-control border border-status-live/30 bg-status-live/5 px-3 py-2 text-xs">
                    <span className="text-status-live">✓ Terkonfigurasi (appId {cfg.app_id})</span>
                    <button type="button" onClick={test} disabled={busy === 'test'} className="rounded-control border border-edge bg-surface px-2.5 py-1 font-medium text-content-muted hover:border-edge-strong">{busy === 'test' ? '…' : 'Tes koneksi'}</button>
                    <button type="button" onClick={() => loadDevices(false)} disabled={busy === 'dev'} className="rounded-control border border-edge bg-surface px-2.5 py-1 font-medium text-content-muted hover:border-edge-strong">{busy === 'dev' ? '…' : 'Muat ulang perangkat'}</button>
                    {devices && devices.length > 0 && (
                        <button type="button" onClick={() => { const n = autoMatch(devices, cfg.cameras || []); showNotification({ type: n ? 'success' : 'info', title: n ? `${n} kamera dicocokkan` : 'Tak ada kecocokan baru' }); }} className="rounded-control border border-edge bg-surface px-2.5 py-1 font-medium text-content-muted hover:border-edge-strong">🔎 Cocokkan otomatis</button>
                    )}
                    <button type="button" onClick={() => { setCfg({ ...cfg, configured: false }); setAppId(''); }} className="text-content-subtle hover:underline">ubah kredensial</button>
                </div>
            )}

            {devices && (
                <p className="text-xs text-content-subtle">
                    {devices.length > 0
                        ? `${devices.length} perangkat terbaca dari akun IMOU — pilih SN tiap kamera dari daftar, tak perlu ketik.`
                        : 'Tak ada perangkat di akun IMOU (pastikan kamera ter-bind di aplikasi IMOU Life).'}
                </p>
            )}

            {/* Per-camera SN mapping (dropdown from cloud devices) + siren */}
            {cfg.configured && (
                <>
                    {pendingCount > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-status-warn/40 bg-status-warn/10 px-3 py-2 text-xs">
                            <span className="text-content-muted">{pendingCount} pemetaan SN belum disimpan.</span>
                            <Button variant="primary" loading={busy === 'save-all'} onClick={saveAllPending}>Simpan semua</Button>
                        </div>
                    )}
                    <ul className="space-y-1.5">
                        {(cfg.cameras || []).map((cam) => {
                            const pending = snEdits[cam.id];
                            const value = pending !== undefined ? pending : (cam.imou_sn || '');
                            const mapped = Boolean((pending !== undefined ? pending : cam.imou_sn));
                            // A saved SN not present in the device list is still shown (device unbound / list not loaded).
                            const known = Array.isArray(devices) && devices.some((d) => d.sn === value);
                            const dirty = pending !== undefined && pending !== (cam.imou_sn || '');
                            return (
                                <li key={cam.id} className="flex flex-wrap items-center gap-2 rounded-control border border-edge px-3 py-2">
                                    <span className="min-w-0 flex-1 truncate text-sm text-content">{cam.name}</span>
                                    {Array.isArray(devices) && devices.length > 0 ? (
                                        <select
                                            value={value}
                                            onChange={(e) => setSnEdits((s) => ({ ...s, [cam.id]: e.target.value }))}
                                            className="w-56 max-w-full rounded-control border border-edge bg-surface px-2 py-1 text-xs text-content focus:border-primary focus:outline-none"
                                        >
                                            <option value="">— tanpa SN —</option>
                                            {devices.map((d) => (
                                                <option key={d.sn} value={d.sn}>{d.name} ({d.sn})</option>
                                            ))}
                                            {value && !known && <option value={value}>{value} (manual)</option>}
                                        </select>
                                    ) : (
                                        <input
                                            type="text"
                                            defaultValue={cam.imou_sn || ''}
                                            onChange={(e) => setSnEdits((s) => ({ ...s, [cam.id]: e.target.value }))}
                                            placeholder="SN IMOU"
                                            className="w-40 rounded-control border border-edge bg-surface px-2 py-1 font-mono text-xs text-content"
                                        />
                                    )}
                                    <button type="button" onClick={() => saveSn(cam)} disabled={busy === `sn-${cam.id}` || !dirty} title={dirty ? '' : 'Tak ada perubahan'} className="rounded-control border border-edge px-2.5 py-1 text-xs font-medium text-content-muted hover:border-edge-strong disabled:opacity-40">Simpan SN</button>
                                    <button type="button" onClick={() => siren(cam, true)} disabled={!mapped || dirty || busy === `siren-${cam.id}`} title={dirty ? 'Simpan SN dulu' : (mapped ? '' : 'Petakan SN dulu')} className="rounded-control border-2 border-status-fault bg-status-fault/10 px-3 py-1 text-xs font-bold text-status-fault hover:bg-status-fault/20 disabled:opacity-40">🔊 ON</button>
                                    <button type="button" onClick={() => siren(cam, false)} disabled={!mapped || dirty || busy === `siren-${cam.id}`} className="rounded-control border border-edge px-2.5 py-1 text-xs font-medium text-content-muted hover:border-edge-strong disabled:opacity-40">OFF</button>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </section>
    );
}
