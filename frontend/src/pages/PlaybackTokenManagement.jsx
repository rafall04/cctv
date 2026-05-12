/*
 * Purpose: Admin page shell for creating, sharing, listing, and revoking scoped playback tokens.
 * Caller: App.jsx protected admin route.
 * Deps: playback token management hook and admin playback-token components.
 * MainFuncs: PlaybackTokenManagement.
 * SideEffects: Delegates admin token API calls and browser share/copy effects to usePlaybackTokenManagementPage.
 */

import PlaybackTokenForm from '../components/admin/playback-tokens/PlaybackTokenForm.jsx';
import PlaybackTokenSharePanel from '../components/admin/playback-tokens/PlaybackTokenSharePanel.jsx';
import PlaybackTokenTable from '../components/admin/playback-tokens/PlaybackTokenTable.jsx';
import { usePlaybackTokenManagementPage } from '../hooks/admin/usePlaybackTokenManagementPage.js';

export default function PlaybackTokenManagement() {
    const page = usePlaybackTokenManagementPage();

    return (
        <div className="space-y-6 py-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Playback Tokens</h1>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    Buat token playback publik dengan scope kamera, masa berlaku, policy device, dan template share.
                </p>
            </div>

            <PlaybackTokenForm
                form={page.form}
                cameras={page.cameras}
                saving={page.saving}
                selectedCameraIds={page.selectedCameraIds}
                onUpdateForm={page.updateForm}
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
                formatTokenDate={page.formatTokenDate}
                onRefresh={page.loadData}
                onEdit={page.beginEditToken}
                onCancelEdit={page.cancelEditToken}
                onUpdateEditForm={page.updateEditForm}
                onToggleEditCameraRule={page.toggleEditCameraRule}
                onUpdateEditCameraRule={page.updateEditCameraRule}
                onUpdateToken={page.handleUpdateToken}
                onRepeatShare={page.handleRepeatShare}
                onClearSessions={page.handleClearSessions}
                onRevoke={page.handleRevoke}
            />

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Log Token Terbaru</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className="px-3 py-2">Waktu</th>
                                <th className="px-3 py-2">Event</th>
                                <th className="px-3 py-2">Token</th>
                                <th className="px-3 py-2">Kamera</th>
                                <th className="px-3 py-2">Actor/IP</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {page.auditLogs.map((log) => (
                                <tr key={log.id} className="text-gray-800 dark:text-gray-200">
                                    <td className="whitespace-nowrap px-3 py-3">{page.formatTokenDate(log.created_at)}</td>
                                    <td className="px-3 py-3">{log.event_type}</td>
                                    <td className="px-3 py-3">
                                        <div>{log.token_label || '-'}</div>
                                        <div className="text-xs text-gray-500">{log.token_prefix || ''}</div>
                                    </td>
                                    <td className="px-3 py-3">{log.camera_name || (log.camera_id ? `ID ${log.camera_id}` : '-')}</td>
                                    <td className="px-3 py-3">
                                        <div>{log.actor_username || '-'}</div>
                                        <div className="text-xs text-gray-500">{log.ip_address || '-'}</div>
                                    </td>
                                </tr>
                            ))}
                            {page.auditLogs.length === 0 && (
                                <tr>
                                    <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>Belum ada log token.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
