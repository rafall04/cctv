/*
 * Purpose: The full queue of what visitors reported about each camera — filter it, read it, close it.
 * Caller: App.jsx protected admin route (/admin/camera-reports).
 * Deps: useCameraReportsPage, components/ui, playbackUrlState.
 * MainFuncs: CameraReportsManagement.
 * SideEffects: Delegates every API call to the page hook.
 *
 * The compact card on Camera Management shows only what is still open, capped at five. This page is
 * where the rest lives: every status, every category, every camera, paged rather than truncated.
 *
 * NOTHING HERE IS PUBLIC. The text was written by anonymous devices and is safe to accept precisely
 * because it is never rendered back to visitors — see cameraReportService.
 */

import { Alert, Badge, Button, Card, PageHeader, TableShell, Table, THead, TBody, TR, TH, TD } from '../components/ui';
import { useCameraReportsPage } from '../hooks/admin/useCameraReportsPage.js';
import { buildPlaybackMomentPath } from '../utils/playbackUrlState';

const STATUS_TABS = [
    { value: 'open', label: 'Belum ditutup' },
    { value: 'baru', label: 'Baru' },
    { value: 'dibaca', label: 'Dibaca' },
    { value: 'selesai', label: 'Selesai' },
    { value: '', label: 'Semua' },
];

const STATUS_TONE = { baru: 'warn', dibaca: 'brand', selesai: 'idle' };

const SELECT_CLASS = 'w-full rounded-control border border-edge-strong bg-surface px-3 py-2 text-sm text-content transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary';

const when = (value) => {
    const at = new Date(String(value || '').replace(' ', 'T'));
    if (Number.isNaN(at.getTime())) return value || '—';
    return at.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function Stat({ label, value, tone = 'text-content' }) {
    return (
        <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-content-subtle">{label}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
        </div>
    );
}

export default function CameraReportsManagement() {
    const page = useCameraReportsPage();
    const { summary, pagination } = page;

    return (
        <div className="space-y-6 py-6">
            <PageHeader
                title="Laporan Kamera"
                description="Yang dilaporkan pengunjung tentang tiap kamera. Tidak pernah ditampilkan di halaman publik."
                actions={<Button variant="secondary" size="sm" onClick={page.reload} loading={page.loading}>Muat ulang</Button>}
            />

            {/*
              * Counts span the whole table even while a filter is applied — see the service. A
              * summary that narrowed with the filter would read "0 belum ditutup" while eleven wait
              * under another tab.
              */}
            {summary && (
                <Card padding="sm">
                    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                        <Stat label="Total" value={summary.total} />
                        <Stat
                            label="Belum ditutup"
                            value={summary.open}
                            tone={summary.open > 0 ? 'text-status-warn' : 'text-content'}
                        />
                        <Stat label="Baru" value={summary.byStatus.baru} />
                        <Stat label="Dibaca" value={summary.byStatus.dibaca} />
                        <Stat label="Selesai" value={summary.byStatus.selesai} />
                    </dl>
                </Card>
            )}

            <Card padding="sm">
                <div className="flex flex-wrap gap-1.5">
                    {STATUS_TABS.map((tab) => (
                        <button
                            key={tab.value || 'semua'}
                            type="button"
                            onClick={() => page.applyFilter({ status: tab.value })}
                            aria-pressed={page.filters.status === tab.value}
                            className={`rounded-control border px-3 py-1.5 text-xs font-medium transition-colors ${
                                page.filters.status === tab.value
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-edge text-content-muted hover:border-edge-strong hover:bg-surface-raised'
                            }`}
                        >
                            {tab.label}
                            {tab.value === 'open' && summary?.open > 0 && (
                                <span className="ml-1.5 tabular-nums">{summary.open}</span>
                            )}
                        </button>
                    ))}
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="block text-xs text-content-subtle">
                        Jenis laporan
                        <select
                            value={page.filters.category}
                            onChange={(event) => page.applyFilter({ category: event.target.value })}
                            className={`mt-1 ${SELECT_CLASS}`}
                        >
                            <option value="">Semua jenis</option>
                            {page.categories.map((category) => (
                                <option key={category.key} value={category.key}>
                                    {category.label}
                                    {summary ? ` (${summary.byCategory[category.key] ?? 0})` : ''}
                                </option>
                            ))}
                        </select>
                    </label>

                    {/* Only cameras that have actually been reported — an option that returns nothing is a dead end. */}
                    <label className="block text-xs text-content-subtle">
                        Kamera
                        <select
                            value={page.filters.cameraId}
                            onChange={(event) => page.applyFilter({ cameraId: event.target.value })}
                            className={`mt-1 ${SELECT_CLASS}`}
                        >
                            <option value="">Semua kamera ({page.cameras.length} pernah dilapor)</option>
                            {page.cameras.map((camera) => (
                                <option key={camera.id} value={camera.id}>{camera.name} ({camera.reports})</option>
                            ))}
                        </select>
                    </label>

                    <label className="block text-xs text-content-subtle">
                        Urutan
                        <select
                            value={page.filters.sort}
                            onChange={(event) => page.applyFilter({ sort: event.target.value })}
                            className={`mt-1 ${SELECT_CLASS}`}
                        >
                            <option value="newest">Terbaru dulu</option>
                            <option value="oldest">Terlama dulu</option>
                        </select>
                    </label>
                </div>

                {page.isFiltered && (
                    <button
                        type="button"
                        onClick={page.resetFilters}
                        className="mt-3 text-xs font-medium text-content-muted underline underline-offset-2 hover:text-content"
                    >
                        Kembalikan ke tampilan awal
                    </button>
                )}
            </Card>

            {page.loadError && <Alert type="error" title="Gagal memuat" message={page.loadError} />}

            {page.loading && !page.reports.length ? (
                <p className="text-sm text-content-muted">Memuat laporan…</p>
            ) : page.reports.length === 0 ? (
                <Card padding="sm">
                    <p className="text-sm text-content-muted">
                        {summary?.total === 0
                            ? 'Belum ada laporan sama sekali dari pengunjung.'
                            : 'Tidak ada laporan yang cocok dengan filter ini.'}
                    </p>
                </Card>
            ) : (
                <TableShell>
                    <Table>
                        <THead>
                            <TR>
                                <TH>Kamera</TH>
                                <TH>Jenis</TH>
                                <TH>Keterangan</TH>
                                <TH>Waktu kejadian</TH>
                                <TH>Dilaporkan</TH>
                                <TH>Status</TH>
                                <TH align="right">Aksi</TH>
                            </TR>
                        </THead>
                        <TBody>
                            {page.reports.map((report) => {
                                const moment = buildPlaybackMomentPath({
                                    camera: report.cameraId,
                                    occurredAt: report.occurredAt,
                                    basePath: '/admin/playback',
                                });
                                return (
                                    <TR key={report.id} interactive>
                                        <TD>
                                            <div className="font-medium text-content">{report.cameraName}</div>
                                            {report.areaName && (
                                                <div className="text-xs text-content-subtle">{report.areaName}</div>
                                            )}
                                        </TD>
                                        <TD><Badge tone="warn">{report.categoryLabel}</Badge></TD>
                                        {/*
                                          * Wrapped and width-capped rather than truncated: a report is
                                          * at most 500 characters and the whole point of opening this
                                          * page is to read what someone wrote.
                                          */}
                                        <TD className="max-w-md whitespace-normal break-words text-content-muted">
                                            {report.message || <span className="text-content-subtle">—</span>}
                                        </TD>
                                        <TD mono>
                                            {report.occurredAt ? (
                                                moment ? (
                                                    <a href={moment} className="font-medium text-primary underline underline-offset-2">
                                                        {report.occurredAt}
                                                    </a>
                                                ) : report.occurredAt
                                            ) : <span className="text-content-subtle">—</span>}
                                        </TD>
                                        <TD mono className="text-content-muted">{when(report.createdAt)}</TD>
                                        <TD><Badge tone={STATUS_TONE[report.status] || 'idle'} dot>{report.status}</Badge></TD>
                                        <TD align="right">
                                            <div className="flex justify-end gap-2">
                                                {report.status === 'baru' && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        loading={page.savingId === report.id}
                                                        onClick={() => page.setStatus(report.id, 'dibaca')}
                                                    >
                                                        Tandai dibaca
                                                    </Button>
                                                )}
                                                {report.status !== 'selesai' ? (
                                                    /* "Tandai selesai", not "Selesai": the status
                                                       tabs above already use the bare word, and an
                                                       action that reads like a filter invites the
                                                       wrong click. */
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        loading={page.savingId === report.id}
                                                        onClick={() => page.setStatus(report.id, 'selesai')}
                                                    >
                                                        Tandai selesai
                                                    </Button>
                                                ) : (
                                                    /* Closing is reversible: a report shut by mistake is
                                                       otherwise gone from every default view. */
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        loading={page.savingId === report.id}
                                                        onClick={() => page.setStatus(report.id, 'dibaca')}
                                                    >
                                                        Buka lagi
                                                    </Button>
                                                )}
                                            </div>
                                        </TD>
                                    </TR>
                                );
                            })}
                        </TBody>
                    </Table>
                </TableShell>
            )}

            {pagination.totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs tabular-nums text-content-muted">
                        Halaman {pagination.page} dari {pagination.totalPages} · {pagination.total} laporan
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={pagination.page <= 1}
                            onClick={() => page.setPage(pagination.page - 1)}
                        >
                            Sebelumnya
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={pagination.page >= pagination.totalPages}
                            onClick={() => page.setPage(pagination.page + 1)}
                        >
                            Berikutnya
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
