export default function FeedbackStatsGrid({ stats }) {
    const items = [
        { label: 'Total', value: stats.total, accent: 'text-gray-900 dark:text-white' },
        { label: 'Belum Dibaca', value: stats.unread, accent: 'text-amber-500' },
        { label: 'Sudah Dibaca', value: stats.read, accent: 'text-primary' },
        { label: 'Selesai', value: stats.resolved, accent: 'text-emerald-500' },
    ];

    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {items.map((item) => (
                <div key={item.label} className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                    <div className={`text-2xl font-bold ${item.accent}`}>{item.value}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{item.label}</div>
                </div>
            ))}
        </div>
    );
}
