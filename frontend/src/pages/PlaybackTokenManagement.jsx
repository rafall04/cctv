/*
 * Purpose: Admin page shell for creating, sharing, listing, and revoking scoped playback tokens.
 * Caller: App.jsx protected admin route.
 * Deps: playback token management hook and admin playback-token components.
 * MainFuncs: PlaybackTokenManagement.
 * SideEffects: Delegates admin token API calls and browser share/copy effects to usePlaybackTokenManagementPage.
 */

import { Button, Modal } from '../components/ui';
import PlaybackTokenForm from '../components/admin/playback-tokens/PlaybackTokenForm.jsx';
import PlaybackTokenSharePanel from '../components/admin/playback-tokens/PlaybackTokenSharePanel.jsx';
import PlaybackTokenTable from '../components/admin/playback-tokens/PlaybackTokenTable.jsx';
import { usePlaybackTokenManagementPage } from '../hooks/admin/usePlaybackTokenManagementPage.js';

export default function PlaybackTokenManagement() {
    const page = usePlaybackTokenManagementPage();

    return (
        <div className="space-y-6 py-6">
            <div>
                <h1 className="text-2xl font-bold text-content">Playback Tokens</h1>
                <p className="mt-1 text-sm text-content-muted">
                    Buat token playback publik dengan scope kamera, masa berlaku, policy device, dan template share.
                </p>
            </div>

            <PlaybackTokenForm
                form={page.form}
                cameras={page.visibleCreateCameras}
                saving={page.saving}
                selectedCameraIds={page.selectedCameraIds}
                areaOptions={page.areaOptions}
                onToggleArea={page.toggleArea}
                cameraSearch={page.cameraSearch}
                totalCameraCount={page.cameras.length}
                visibleCameraCount={page.visibleCreateCameras.length}
                onUpdateForm={page.updateForm}
                onUpdateCameraSearch={page.setCameraSearch}
                onToggleCameraRule={page.toggleCameraRule}
                onUpdateCameraRule={page.updateCameraRule}
                onSubmit={page.handleCreate}
            />

            <PlaybackTokenSharePanel
                createdShare={page.createdShare}
                whatsappHref={page.whatsappHref}
                onCopy={page.handleCopy}
                onNativeShare={page.handleNativeShare}
            />

            <PlaybackTokenTable
                tokens={page.tokens}
                loading={page.loading}
                editingTokenId={page.editingTokenId}
                updatingTokenId={page.updatingTokenId}
                sharingTokenId={page.sharingTokenId}
                editForm={page.editForm}
                selectedEditCameraIds={page.selectedEditCameraIds}
                cameras={page.cameras}
                visibleEditCameras={page.visibleEditCameras}
                editCameraSearch={page.editCameraSearch}
                totalCameraCount={page.cameras.length}
                visibleEditCameraCount={page.visibleEditCameras.length}
                formatTokenDate={page.formatTokenDate}
                onRefresh={page.loadData}
                onEdit={page.beginEditToken}
                onCancelEdit={page.cancelEditToken}
                onUpdateEditForm={page.updateEditForm}
                onUpdateEditCameraSearch={page.setEditCameraSearch}
                onToggleEditCameraRule={page.toggleEditCameraRule}
                onUpdateEditCameraRule={page.updateEditCameraRule}
                onUpdateToken={page.handleUpdateToken}
                onRepeatShare={page.handleRepeatShare}
                onClearSessions={page.handleClearSessions}
                onRevoke={page.handleRevoke}
                onDelete={page.handleDelete}
                deletingTokenId={page.deletingTokenId}
            />

            {/*
              * Sharing an existing token opens HERE, over the row that was tapped. It used to write
              * into the panel beside the create form at the top of the page, so re-sharing the
              * twelfth token meant scrolling all the way up to find the result and back down again.
              */}
            {page.sharePreview && (
                <Modal
                    title={`Bagikan "${page.sharePreview.label}"`}
                    description="Kode akses yang sama, siap dikirim ulang."
                    onClose={() => page.setSharePreview(null)}
                    size="md"
                    footer={(
                        <>
                            <Button variant="secondary" onClick={() => page.handleCopy(page.sharePreview.shareText)}>
                                Salin Teks
                            </Button>
                            <Button variant="secondary" onClick={() => page.handleNativeShare(page.sharePreview.shareText)}>
                                Bagikan
                            </Button>
                            <a
                                href={`https://wa.me/?text=${encodeURIComponent(page.sharePreview.shareText)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex h-11 items-center rounded-control bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
                            >
                                WhatsApp
                            </a>
                        </>
                    )}
                >
                    <pre className="whitespace-pre-wrap break-words rounded-card bg-surface-sunken p-3 font-mono text-xs text-content">
                        {page.sharePreview.shareText}
                    </pre>
                </Modal>
            )}

            <div className="rounded-lg border border-edge bg-surface p-5 shadow-sm">
                <div className="mb-4">
                    <h2 className="text-lg font-semibold text-content">Log Token Terbaru</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead className="text-left text-xs uppercase tracking-wide text-content-muted">
                            <tr>
                                <th className="px-3 py-2">Waktu</th>
                                <th className="px-3 py-2">Event</th>
                                <th className="px-3 py-2">Token</th>
                                <th className="px-3 py-2">Kamera</th>
                                <th className="px-3 py-2">Actor/IP</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-edge">
                            {page.auditLogs.map((log) => (
                                <tr key={log.id} className="text-content">
                                    <td className="whitespace-nowrap px-3 py-3">{page.formatTokenDate(log.created_at)}</td>
                                    <td className="px-3 py-3">{log.event_type}</td>
                                    <td className="px-3 py-3">
                                        <div>{log.token_label || '-'}</div>
                                        <div className="text-xs text-content-muted">{log.token_prefix || ''}</div>
                                    </td>
                                    <td className="px-3 py-3">{log.camera_name || (log.camera_id ? `ID ${log.camera_id}` : '-')}</td>
                                    <td className="px-3 py-3">
                                        <div>{log.actor_username || '-'}</div>
                                        <div className="text-xs text-content-muted">{log.ip_address || '-'}</div>
                                    </td>
                                </tr>
                            ))}
                            {page.auditLogs.length === 0 && (
                                <tr>
                                    <td className="px-3 py-6 text-center text-content-muted" colSpan={5}>Belum ada log token.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
