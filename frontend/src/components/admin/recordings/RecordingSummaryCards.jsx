function formatFileSize(bytes) {
    if (bytes === 0) {
        return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const index = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / Math.pow(k, index)) * 100) / 100} ${sizes[index]}`;
}

export default function RecordingSummaryCards({ summary }) {
    const items = [
        {
            label: 'Kamera Recording',
            value: summary.recordingCount,
            accent: 'text-red-500 dark:text-red-400',
            tone: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200',
        },
        {
            label: 'Total Kamera',
            value: summary.cameras,
            accent: 'text-gray-900 dark:text-white',
            tone: 'bg-gray-100 text-gray-700 dark:bg-gray-700/80 dark:text-gray-100',
        },
        {
            label: 'Total Segmen',
            value: summary.totalSegments,
            accent: 'text-primary-600 dark:text-primary-300',
            tone: 'bg-sky-50 text-sky-700 dark:bg-primary/20 dark:text-sky-200',
        },
        {
            label: 'Total Storage',
            value: formatFileSize(summary.totalSize),
            accent: 'text-emerald-600 dark:text-emerald-300',
            tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
        },
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {items.map((item) => (
                <div key={item.label} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-800/60">
                    <div
                        data-testid={`summary-label-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                        className={`mb-3 inline-flex rounded-xl px-3 py-1 text-xs font-semibold ${item.tone}`}
                    >
                        {item.label}
                    </div>
                    <div className={`text-2xl font-bold ${item.accent}`}>{item.value}</div>
                </div>
            ))}
        </div>
    );
}
