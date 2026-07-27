import { StatTile } from '../../ui';

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
    /*
     * None of these four is a health reading — they are counts. "Kamera Recording" wore the fault
     * red, which made a perfectly healthy fleet look alarmed; storage wore green, which implied
     * "good" about a number that is only ever "how much". All four now use the data accent, with
     * the plain surface for the neutral total.
     */
    const items = [
        { label: 'Kamera Recording', value: summary.recordingCount, tone: 'data' },
        { label: 'Total Kamera', value: summary.cameras, tone: 'default' },
        { label: 'Total Segmen', value: summary.totalSegments, tone: 'data' },
        { label: 'Total Storage', value: formatFileSize(summary.totalSize), tone: 'data' },
    ];

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((item) => (
                <StatTile
                    key={item.label}
                    label={item.label}
                    value={item.value}
                    tone={item.tone}
                    data-testid={`summary-label-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                />
            ))}
        </div>
    );
}
