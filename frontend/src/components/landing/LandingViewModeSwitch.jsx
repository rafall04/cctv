import { Icons } from '../ui/Icons';

export default function LandingViewModeSwitch({ viewMode, onChange }) {
    const buttons = [
        { key: 'map', label: 'Peta', title: 'Map View', icon: <Icons.Map /> },
        { key: 'grid', label: 'Grid', title: 'Grid View (Multi-View)', icon: <Icons.Grid /> },
        { key: 'playback', label: 'Playback', title: 'Playback Rekaman', icon: <Icons.Clock /> },
    ];

    return (
        <div className="flex items-center p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
            {buttons.map((button) => (
                <button
                    key={button.key}
                    onClick={() => onChange(button.key)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                        viewMode === button.key
                            ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                    title={button.title}
                >
                    {button.icon}
                    <span>{button.label}</span>
                </button>
            ))}
        </div>
    );
}
