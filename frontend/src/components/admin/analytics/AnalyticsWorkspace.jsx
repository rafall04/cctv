const DEFAULT_TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'active', label: 'Active' },
    { id: 'history', label: 'History' },
    { id: 'top', label: 'Top' },
    { id: 'audience', label: 'Audience' },
];

export function AnalyticsWorkspaceHeader({ title, description, lastUpdate, filters }) {
    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-content">{title}</h1>
                    {description && (
                        <p className="text-sm text-content-muted">{description}</p>
                    )}
                </div>
                <div className="text-xs text-content-muted">
                    Update terakhir: {lastUpdate ? lastUpdate.toLocaleTimeString('id-ID') : '-'}
                </div>
            </div>
            {filters}
        </div>
    );
}

export function AnalyticsTabNav({ tabs = DEFAULT_TABS, activeTab, onChange }) {
    return (
        <div className="rounded-2xl border border-edge bg-surface p-2">
            <div className="flex flex-wrap gap-2">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => onChange(tab.id)}
                        className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                            activeTab === tab.id
                                ? 'bg-primary text-white shadow-lg shadow-primary/20'
                                : 'text-content-muted hover:bg-surface-sunken'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

export default AnalyticsWorkspaceHeader;
