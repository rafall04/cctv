/*
Purpose: Render top-level recording assurance counters for degraded recording health states.
Caller: RecordingDashboard after assurance data loads.
Deps: assurance summary payload and dashboard Tailwind styles.
MainFuncs: RecordingAssuranceSummary.
SideEffects: None; presentational only.
*/

const ITEMS = [
    {
        key: 'recording_down',
        label: 'Recording Down',
        tone: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-100',
        caption: 'Proses recording tidak aktif',
    },
    {
        key: 'stale_segments',
        label: 'Stale Segments',
        tone: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100',
        caption: 'Segmen terbaru terlalu lama',
    },
    {
        key: 'missing_segments',
        label: 'Missing Segments',
        tone: 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-100',
        caption: 'Belum ada segmen setelah start',
    },
    {
        key: 'recent_gap_cameras',
        label: 'Recent Gaps',
        tone: 'border-primary-300 bg-primary-100 text-primary dark:bg-primary/10',
        caption: 'Ada gap segmen terbaru',
    },
];

export default function RecordingAssuranceSummary({ summary }) {
    if (!summary) {
        return null;
    }

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {ITEMS.map((item) => {
                // A zero-count card must NOT stay coloured (red/amber/orange on "0" reads as a false alarm on
                // a perfectly healthy fleet). Neutral surface when the count is 0; the alert tone only when >0.
                const count = summary[item.key] ?? 0;
                const tone = count > 0 ? item.tone : 'border-edge bg-surface text-content';
                return (
                    <div key={item.key} className={`rounded-2xl border p-5 shadow-sm ${tone}`}>
                        <p className="text-sm font-semibold">{item.label}</p>
                        <p className="mt-3 text-3xl font-bold tabular-nums">{count}</p>
                        <p className="mt-2 text-xs font-medium opacity-80">{item.caption}</p>
                    </div>
                );
            })}
        </div>
    );
}
