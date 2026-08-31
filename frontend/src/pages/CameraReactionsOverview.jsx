/*
 * Purpose: What visitors think of every community camera — the whole fleet, not just the ones with
 *          complaints.
 * Caller: App.jsx protected admin route (/admin/camera-reactions).
 * Deps: useCameraReactionsPage, components/ui.
 * MainFuncs: CameraReactionsOverview.
 * SideEffects: Delegates its one API call to the page hook.
 *
 * Read-only on purpose. There is no way to delete or adjust a vote from here: an operator who could
 * edit the verdict would make it worthless as a measurement, and the counts are public — a camera
 * showing 30 complaints on the public page while the admin table showed something else would be a
 * contradiction visitors could see.
 *
 * Unrated cameras are LISTED, not hidden. "36 kamera, 4 pernah dinilai" is the fact that decides
 * whether anything below it means anything; a leaderboard of three, presented alone, reads as a
 * verdict on the fleet.
 */

import { Alert, Badge, Button, Card, PageHeader, TableShell, Table, THead, TBody, TR, TH, TD, SortableTH } from '../components/ui';
import { useCameraReactionsPage, positiveShare } from '../hooks/admin/useCameraReactionsPage.js';
import { useTimezone, parseBackendDateInput, TIMESTAMP_STORAGE } from '../contexts/TimezoneContext';

const when = (value, timeZone) => {
    if (!value) return '—';
    const at = parseBackendDateInput(value, { storage: TIMESTAMP_STORAGE.UTC_SQL });
    if (Number.isNaN(at.getTime())) return value;
    return at.toLocaleString('id-ID', { timeZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function Stat({ label, value, tone = 'text-content' }) {
    return (
        <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">{label}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
        </div>
    );
}

export default function CameraReactionsOverview() {
    const page = useCameraReactionsPage();
    const { timezone } = useTimezone();
    const { totals, sort } = page;

    /** 'none' for every column except the active one — SortableTH turns that into aria-sort. */
    const dir = (key) => (sort.key === key ? sort.direction : 'none');

    return (
        <div className="space-y-6 py-6">
            <PageHeader
                title="Penilaian Kamera"
                description="Hasil tombol Bagus / Bermasalah di halaman publik. Angkanya juga terlihat oleh pengunjung; halaman ini yang bisa mengurutkan seluruh armada."
                actions={<Button variant="secondary" size="sm" onClick={page.reload} loading={page.loading}>Muat ulang</Button>}
            />

            {totals && (
                <Card padding="sm">
                    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <Stat label="Kamera publik" value={totals.cameras} />
                        {/*
                          * The denominator. Without it a table sorted by complaints looks like a
                          * fleet-wide verdict when it may rest on four votes.
                          */}
                        <Stat label="Pernah dinilai" value={`${totals.rated} dari ${totals.cameras}`} />
                        <Stat label="Total bagus" value={totals.likes} />
                        <Stat
                            label="Total bermasalah"
                            value={totals.dislikes}
                            tone={totals.dislikes > 0 ? 'text-status-warn' : 'text-content'}
                        />
                    </dl>
                </Card>
            )}

            <Card padding="sm">
                <div className="grid gap-3 sm:grid-cols-[1fr,auto] sm:items-center">
                    <label className="block text-xs text-content-subtle">
                        Cari kamera atau area
                        <input
                            type="search"
                            value={page.search}
                            onChange={(event) => page.setSearch(event.target.value)}
                            placeholder="Nama kamera atau area…"
                            className="mt-1 w-full rounded-control border border-edge-strong bg-surface px-3 py-2 text-sm text-content transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                        />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-content sm:pt-5">
                        <input
                            type="checkbox"
                            checked={page.ratedOnly}
                            onChange={(event) => page.setRatedOnly(event.target.checked)}
                            className="h-4 w-4 rounded border-edge text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        />
                        Hanya yang sudah dinilai
                    </label>
                </div>
            </Card>

            {page.loadError && <Alert type="error" title="Gagal memuat" message={page.loadError} />}

            {page.loading && !page.cameras.length ? (
                <p className="text-sm text-content-muted">Memuat penilaian…</p>
            ) : page.cameras.length === 0 ? (
                <Card padding="sm">
                    <p className="text-sm text-content-muted">Tidak ada kamera yang cocok dengan pencarian ini.</p>
                </Card>
            ) : (
                <TableShell>
                    <Table>
                        <THead>
                            <TR>
                                <SortableTH direction={dir('name')} onSort={(d) => page.sortBy('name', d)}>Kamera</SortableTH>
                                <SortableTH direction={dir('area')} onSort={(d) => page.sortBy('area', d)}>Area</SortableTH>
                                <SortableTH align="right" direction={dir('likes')} onSort={(d) => page.sortBy('likes', d)}>Bagus</SortableTH>
                                <SortableTH align="right" direction={dir('dislikes')} onSort={(d) => page.sortBy('dislikes', d)}>Bermasalah</SortableTH>
                                <SortableTH align="right" direction={dir('total')} onSort={(d) => page.sortBy('total', d)}>Total suara</SortableTH>
                                <SortableTH align="right" direction={dir('share')} onSort={(d) => page.sortBy('share', d)}>Positif</SortableTH>
                                <SortableTH direction={dir('lastVoteAt')} onSort={(d) => page.sortBy('lastVoteAt', d)}>Suara terakhir</SortableTH>
                                <TH>Status</TH>
                            </TR>
                        </THead>
                        <TBody>
                            {page.cameras.map((camera) => {
                                const share = positiveShare(camera);
                                return (
                                    <TR key={camera.id} interactive>
                                        <TD className="font-medium">{camera.name}</TD>
                                        <TD className="text-content-muted">{camera.areaName || '—'}</TD>
                                        <TD align="right" mono>{camera.likes || <span className="text-content-subtle">0</span>}</TD>
                                        <TD align="right" mono className={camera.dislikes > 0 ? 'text-status-warn' : ''}>
                                            {camera.dislikes || <span className="text-content-subtle">0</span>}
                                        </TD>
                                        <TD align="right" mono className="text-content-muted">{camera.total}</TD>
                                        {/*
                                          * A dash, never "0%", when nobody has voted. 0% is a verdict;
                                          * no votes is an absence of one.
                                          */}
                                        <TD align="right" mono>
                                            {share === null ? <span className="text-content-subtle">—</span> : `${share}%`}
                                        </TD>
                                        <TD mono className="text-content-muted">{when(camera.lastVoteAt, timezone)}</TD>
                                        <TD>
                                            {camera.enabled
                                                ? <Badge tone="live" dot>Tayang</Badge>
                                                : <Badge tone="idle" dot>Dimatikan</Badge>}
                                        </TD>
                                    </TR>
                                );
                            })}
                        </TBody>
                    </Table>
                </TableShell>
            )}

            <p className="text-xs leading-5 text-content-subtle">
                Penilaian tidak bisa diubah atau dihapus dari sini. Angka yang sama tampil di halaman
                publik, jadi mengeditnya akan membuat kedua sisi saling bertentangan di depan pengunjung.
            </p>
        </div>
    );
}
