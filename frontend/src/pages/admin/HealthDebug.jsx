import CameraHealthDebugPanel from '../../components/admin/cameras/CameraHealthDebugPanel';
import { useHealthDebugPage } from '../../hooks/admin/useHealthDebugPage';

export default function HealthDebug() {
    const {
        query,
        summary,
        items,
        pagination,
        loading,
        error,
        refreshError,
        lastUpdated,
        setFilter,
        setPage,
        refresh,
    } = useHealthDebugPage();

    return (
        <div className="space-y-8">
            <div className="space-y-2">
                <p className="text-sm font-semibold text-primary">Operations</p>
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Health Debug</h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Diagnostik internal backend health, runtime evidence, dan status publik playable.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={refresh}
                        className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600"
                    >
                        Refresh
                    </button>
                </div>
                {refreshError ? (
                    <p className="text-sm text-amber-600 dark:text-amber-300">
                        Refresh background terakhir gagal. Data yang tampil masih hasil fetch sukses sebelumnya.
                    </p>
                ) : null}
            </div>

            <CameraHealthDebugPanel
                summary={summary}
                items={items}
                pagination={pagination}
                query={query}
                loading={loading}
                error={error}
                lastUpdated={lastUpdated}
                onFilterChange={setFilter}
                onPageChange={setPage}
            />
        </div>
    );
}
