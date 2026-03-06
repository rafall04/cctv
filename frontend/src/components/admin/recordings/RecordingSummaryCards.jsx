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
        { label: 'Kamera Recording', value: summary.recordingCount, accent: 'text-red-400' },
        { label: 'Total Kamera', value: summary.cameras, accent: 'text-white' },
        { label: 'Total Segmen', value: summary.totalSegments, accent: 'text-primary-400' },
        { label: 'Total Storage', value: formatFileSize(summary.totalSize), accent: 'text-emerald-400' },
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {items.map((item) => (
                <div key={item.label} className="bg-dark-900/90 backdrop-blur-md border border-dark-700/50 rounded-xl p-6">
                    <div className={`text-2xl font-bold ${item.accent}`}>{item.value}</div>
                    <div className="text-sm text-dark-300 mt-1">{item.label}</div>
                </div>
            ))}
        </div>
    );
}
