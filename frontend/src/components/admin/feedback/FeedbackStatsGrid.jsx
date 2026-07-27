export default function FeedbackStatsGrid({ stats }) {
    const items = [
        { label: 'Total', value: stats.total, accent: 'text-content' },
        { label: 'Belum Dibaca', value: stats.unread, accent: 'text-amber-500' },
        { label: 'Sudah Dibaca', value: stats.read, accent: 'text-primary' },
        { label: 'Selesai', value: stats.resolved, accent: 'text-emerald-500' },
    ];

    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {items.map((item) => (
                <div key={item.label} className="bg-surface rounded-xl p-4 border border-edge">
                    <div className={`text-2xl font-bold ${item.accent}`}>{item.value}</div>
                    <div className="text-sm text-content-muted">{item.label}</div>
                </div>
            ))}
        </div>
    );
}
