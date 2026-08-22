import { Button, PageHeader } from '../../components/ui';
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
                {/* Was the surface's single `text-3xl` title — 8px larger than the next-biggest
                    admin h1 — plus a `text-sm` eyebrow that read as one block with the description
                    below it. Both now come from the primitive. */}
                <PageHeader
                    eyebrow="Operations"
                    title="Diagnostik Kesehatan"
                    description="Diagnostik internal backend health, runtime evidence, dan status publik playable."
                    actions={<Button variant="primary" onClick={refresh}>Refresh</Button>}
                />
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
