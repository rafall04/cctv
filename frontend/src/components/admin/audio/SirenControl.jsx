/*
 * Purpose: Native SIREN control via IMOU Cloud — the camera's built-in active-deterrence siren is far
 *   louder than the ONVIF two-way-talk backchannel. One-time setup: IMOU OpenAPI app credentials
 *   (appId/appSecret from open.imoulife.com) + map each camera to its IMOU device SN; then a per-camera
 *   Siren ON/OFF. Firing is confirmed (it's loud) and cloud-routed.
 * Caller: pages/AudioBroadcast.jsx (Panel tab, under the emergency bar).
 * Deps: audioService (imou config/devices/siren), contexts, components/ui.
 * MainFuncs: SirenControl.
 * SideEffects: saves IMOU creds/SN; fires the physical camera siren.
 */

import { useCallback, useEffect, useState } from 'react';
import { getImouConfig, setImouConfig, testImou, getImouDevices, setCameraImouSn, cameraSiren } from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { Button, Field } from '../../ui';

export default function SirenControl() {
    const [cfg, setCfg] = useState(null);
    const [appId, setAppId] = useState('');
    const [appSecret, setAppSecret] = useState('');
    const [devices, setDevices] = useState(null);
    const [busy, setBusy] = useState(null);
    const [snEdits, setSnEdits] = useState({});
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    const load = useCallback(async () => {
        const r = await getImouConfig();
        if (r.success) setCfg(r.data);
    }, []);
    useEffect(() => { load(); }, [load]);

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
    const loadDevices = async () => {
        setBusy('dev');
        const r = await getImouDevices();
        setBusy(null);
        if (r.success) setDevices(r.data || []);
        else showNotification({ type: 'error', title: 'Gagal', message: r.message });
    };
    const saveSn = async (cam) => {
        const sn = (snEdits[cam.id] ?? cam.imou_sn ?? '').trim();
        setBusy(`sn-${cam.id}`);
        const r = await setCameraImouSn(cam.id, sn);
        setBusy(null);
        if (r.success) { showNotification({ type: 'success', title: 'SN disimpan', message: cam.name }); load(); }
        else showNotification({ type: 'error', title: 'Gagal', message: r.message });
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
    };

    if (!cfg) return null;

    return (
        <section className="space-y-3 rounded-card border border-edge bg-surface p-4 shadow-e1">
            <div>
                <h3 className="text-sm font-semibold text-content">🔊 Sirene native (IMOU Cloud)</h3>
                <p className="mt-0.5 text-xs text-content-muted">Sirene bawaan kamera — jauh lebih keras dari jalur suara biasa. Lewat cloud IMOU (butuh internet + kamera ter-bind di IMOU Life).</p>
            </div>

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
                    <button type="button" onClick={loadDevices} disabled={busy === 'dev'} className="rounded-control border border-edge bg-surface px-2.5 py-1 font-medium text-content-muted hover:border-edge-strong">{busy === 'dev' ? '…' : 'Muat perangkat IMOU'}</button>
                    <button type="button" onClick={() => { setCfg({ ...cfg, configured: false }); setAppId(''); }} className="text-content-subtle hover:underline">ubah kredensial</button>
                </div>
            )}

            {devices && (
                <div className="rounded-control border border-edge bg-surface-sunken p-2 text-xs">
                    <span className="font-semibold text-content-muted">Perangkat di akun IMOU (SN → nama):</span>
                    <ul className="mt-1 space-y-0.5">
                        {devices.length === 0 ? <li className="text-content-subtle">tak ada perangkat</li> : devices.map((d) => (
                            <li key={d.sn} className="font-mono text-content-muted">{d.sn} — <span className="font-sans">{d.name}</span></li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Per-camera SN mapping + siren */}
            {cfg.configured && (
                <ul className="space-y-1.5">
                    {(cfg.cameras || []).map((cam) => {
                        const mapped = Boolean(cam.imou_sn);
                        return (
                            <li key={cam.id} className="flex flex-wrap items-center gap-2 rounded-control border border-edge px-3 py-2">
                                <span className="min-w-0 flex-1 truncate text-sm text-content">{cam.name}</span>
                                <input
                                    type="text"
                                    defaultValue={cam.imou_sn || ''}
                                    onChange={(e) => setSnEdits((s) => ({ ...s, [cam.id]: e.target.value }))}
                                    placeholder="SN IMOU"
                                    className="w-40 rounded-control border border-edge bg-surface px-2 py-1 font-mono text-xs text-content"
                                />
                                <button type="button" onClick={() => saveSn(cam)} disabled={busy === `sn-${cam.id}`} className="rounded-control border border-edge px-2.5 py-1 text-xs font-medium text-content-muted hover:border-edge-strong">Simpan SN</button>
                                <button type="button" onClick={() => siren(cam, true)} disabled={!mapped || busy === `siren-${cam.id}`} title={mapped ? '' : 'Petakan SN dulu'} className="rounded-control border-2 border-status-fault bg-status-fault/10 px-3 py-1 text-xs font-bold text-status-fault hover:bg-status-fault/20 disabled:opacity-40">🔊 ON</button>
                                <button type="button" onClick={() => siren(cam, false)} disabled={!mapped || busy === `siren-${cam.id}`} className="rounded-control border border-edge px-2.5 py-1 text-xs font-medium text-content-muted hover:border-edge-strong disabled:opacity-40">OFF</button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
