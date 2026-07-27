/*
 * Purpose: Add/edit form for one Telegram archive route — scope, target camera or area, group id
 *          (with a pre-save check against Telegram), label, and enabled flag.
 * Caller: pages/TelegramArchiveSettings.jsx.
 * Deps: React, archiveUi class recipes.
 * MainFuncs: RouteForm.
 *
 * The verification result is announced via aria-live and carries an icon, not colour alone, so it
 * reads the same to a screen reader and to anyone who cannot separate the green from the amber.
 */

import { btnGhost, btnPrimary, card, cardTitle, hint, input, label } from './archiveUi';

function CheckIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true">
            <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                clipRule="evenodd"
            />
        </svg>
    );
}

function WarnIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true">
            <path
                fillRule="evenodd"
                d="M8.5 2.9a1.7 1.7 0 0 1 3 0l6.2 11.4a1.7 1.7 0 0 1-1.5 2.5H3.8a1.7 1.7 0 0 1-1.5-2.5L8.5 2.9ZM10 7a.9.9 0 0 0-.9.9v3a.9.9 0 0 0 1.8 0v-3A.9.9 0 0 0 10 7Zm0 6.4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
                clipRule="evenodd"
            />
        </svg>
    );
}

export function RouteForm({
    draft, setField, cameras, areas, groups, editing, manual, onToggleManual, onPickGroup,
    onSubmit, onCancel, onVerify, verifying, verified, saving,
}) {
    const usePicker = groups.length > 0 && !manual;

    return (
        <section className={card}>
            <div className="border-b border-edge px-4 py-3 sm:px-5">
                <h2 className={cardTitle}>{editing ? 'Ubah rute' : 'Tambah rute baru'}</h2>
                <p className="mt-0.5 text-xs text-content-subtle">
                    Rekaman kamera yang dipilih dikirim ke grup ini setiap 10 menit.
                </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-5 p-4 sm:p-5">
                <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                        <label className={label} htmlFor="tga-scope">Cakupan</label>
                        <select
                            id="tga-scope"
                            className={input}
                            value={draft.scope}
                            onChange={(e) => setField('scope', e.target.value)}
                        >
                            <option value="camera">Satu kamera</option>
                            <option value="area">Satu area (semua kameranya)</option>
                            <option value="all">Semua kamera</option>
                        </select>
                    </div>

                    {draft.scope === 'camera' && (
                        <div>
                            <label className={label} htmlFor="tga-camera">Kamera</label>
                            <select
                                id="tga-camera"
                                className={input}
                                value={draft.cameraId}
                                onChange={(e) => setField('cameraId', e.target.value)}
                                required
                            >
                                <option value="">— pilih kamera —</option>
                                {cameras.map((camera) => (
                                    <option key={camera.id} value={camera.id}>
                                        {camera.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {draft.scope === 'area' && (
                        <div>
                            <label className={label} htmlFor="tga-area">Area</label>
                            <select
                                id="tga-area"
                                className={input}
                                value={draft.areaId}
                                onChange={(e) => setField('areaId', e.target.value)}
                                required
                            >
                                <option value="">— pilih area —</option>
                                {areas.map((area) => (
                                    <option key={area.id} value={area.id}>{area.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                <p className={hint}>
                    Kalau satu kamera cocok ke dua rute, rute kamera yang menang. Grup lain hanya
                    menerima salinan, jadi tidak menambah beban internet.
                </p>

                <div>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                        {/* The label must follow whichever control is actually rendered — with no
                            groups discovered yet the picker never mounts, so pointing at it left
                            the field unlabelled for screen readers. */}
                        <label className={`${label} mb-0`} htmlFor={usePicker ? 'tga-group' : 'tga-chat'}>
                            Grup Telegram
                        </label>
                        {groups.length > 0 && (
                            <button
                                type="button"
                                className="text-xs text-content-muted underline underline-offset-2
                                    hover:text-content focus:outline-none focus-visible:ring-2
                                    focus-visible:ring-primary-500"
                                onClick={onToggleManual}
                            >
                                {manual ? 'Pilih dari daftar' : 'Ketik ID manual'}
                            </button>
                        )}
                    </div>

                    {usePicker ? (
                        <>
                            <select
                                id="tga-group"
                                className={input}
                                value={draft.chatId}
                                onChange={(e) => onPickGroup(e.target.value)}
                                required
                            >
                                <option value="">— pilih grup —</option>
                                {groups.map((group) => (
                                    <option key={group.chatId} value={group.chatId}>
                                        {group.title}
                                        {group.canSend === false ? ' (bot tak boleh kirim file)' : ''}
                                    </option>
                                ))}
                            </select>
                            <p className={hint}>
                                Daftar ini terisi sendiri: tambahkan bot ke sebuah grup, lalu grup itu
                                langsung muncul di sini.
                            </p>
                        </>
                    ) : (
                        <div className="flex gap-2">
                            <input
                                id="tga-chat"
                                className={`${input} flex-1 font-mono tabular-nums`}
                                value={draft.chatId}
                                onChange={(e) => setField('chatId', e.target.value)}
                                placeholder="-5510674082"
                                autoComplete="off"
                                spellCheck="false"
                                required
                            />
                            <button
                                type="button"
                                className={`${btnGhost} shrink-0 px-4`}
                                onClick={onVerify}
                                disabled={verifying}
                            >
                                {verifying ? 'Memeriksa…' : 'Periksa'}
                            </button>
                        </div>
                    )}

                    <div aria-live="polite">
                        {verified ? (
                            /* The status colour rides the icon and the border, not the sentence:
                               status-live text on its own 10% tint measures 3.77:1 in light mode,
                               under the 4.5:1 floor. Body text stays on `content`, which clears
                               15:1 in both themes, and colour remains a secondary cue. */
                            <p
                                className={`mt-2 flex items-start gap-2 rounded-control border px-3 py-2 text-xs leading-relaxed text-content ${
                                    verified.canSendDocuments
                                        ? 'border-status-live/40 bg-status-live/10'
                                        : 'border-status-warn/40 bg-status-warn/10'
                                }`}
                            >
                                <span className={verified.canSendDocuments ? 'text-status-live' : 'text-status-warn'}>
                                    {verified.canSendDocuments ? <CheckIcon /> : <WarnIcon />}
                                </span>
                                <span className="min-w-0 break-words">
                                    <strong className="font-semibold">{verified.title}</strong>
                                    {verified.canSendDocuments
                                        ? ' — bot bisa mengirim file ke grup ini.'
                                        : ' — bot TIDAK diizinkan mengirim file di grup ini.'}
                                </span>
                            </p>
                        ) : (manual || groups.length === 0) && (
                            <p className={hint}>
                                {groups.length === 0
                                    ? 'Belum ada grup terdeteksi. Tambahkan bot ke grup — grupnya akan '
                                      + 'muncul di daftar dalam beberapa detik, tanpa perlu ID.'
                                    : 'Tekan Periksa untuk memastikan ID-nya benar sebelum disimpan.'}
                            </p>
                        )}
                    </div>
                </div>

                <div>
                    <label className={label} htmlFor="tga-label">Nama rute</label>
                    <input
                        id="tga-label"
                        className={input}
                        value={draft.label}
                        onChange={(e) => setField('label', e.target.value)}
                        placeholder="Arsip Selatan AHASS"
                        maxLength={80}
                    />
                    <p className={hint}>Hanya untuk memudahkan Anda mengenalinya di daftar.</p>
                </div>

                <label
                    htmlFor="tga-enabled"
                    className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm text-content"
                >
                    <input
                        id="tga-enabled"
                        type="checkbox"
                        className="h-5 w-5 rounded border-edge bg-surface-sunken text-primary-600
                            focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        checked={draft.enabled}
                        onChange={(e) => setField('enabled', e.target.checked)}
                    />
                    Aktif
                </label>

                <div className="flex flex-col gap-2 border-t border-edge pt-4 sm:flex-row">
                    <button type="submit" className={btnPrimary} disabled={saving}>
                        {saving ? 'Menyimpan…' : editing ? 'Simpan perubahan' : 'Tambah rute'}
                    </button>
                    {editing && (
                        <button type="button" className={btnGhost} onClick={onCancel}>
                            Batal
                        </button>
                    )}
                </div>
            </form>
        </section>
    );
}

export default RouteForm;
