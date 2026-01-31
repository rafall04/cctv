import { useState } from 'react';

/**
 * Date Range Selector Component
 * Quick filters and custom date range picker
 */
export function DateRangeSelector({ value = 'today', onChange }) {
    const [showCustom, setShowCustom] = useState(false);
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');

    const presets = [
        { value: 'today', label: 'Hari Ini', icon: '📅' },
        { value: 'yesterday', label: 'Kemarin', icon: '📆' },
        { value: '7days', label: '7 Hari', icon: '📊' },
        { value: '30days', label: '30 Hari', icon: '📈' },
        { value: 'custom', label: 'Custom', icon: '🗓️' },
    ];

    const handlePresetClick = (preset) => {
        if (preset === 'custom') {
            setShowCustom(true);
        } else {
            setShowCustom(false);
            onChange(preset);
        }
    };

    const handleCustomApply = () => {
        if (customStart && customEnd) {
            onChange('custom', { start: customStart, end: customEnd });
            setShowCustom(false);
        }
    };

    const getDateRange = (preset) => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        switch (preset) {
            case 'today':
                return { start: today, end: now };
            case 'yesterday':
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                return { start: yesterday, end: today };
            case '7days':
                const week = new Date(today);
                week.setDate(week.getDate() - 7);
                return { start: week, end: now };
            case '30days':
                const month = new Date(today);
                month.setDate(month.getDate() - 30);
                return { start: month, end: now };
            default:
                return null;
        }
    };

    const formatDateRange = (preset) => {
        if (preset === 'custom') return 'Custom Range';
        const range = getDateRange(preset);
        if (!range) return '';
        
        const formatDate = (date) => {
            return new Intl.DateTimeFormat('id-ID', {
                day: 'numeric',
                month: 'short',
            }).format(date);
        };
        
        if (preset === 'today') return 'Hari Ini';
        if (preset === 'yesterday') return 'Kemarin';
        
        return `${formatDate(range.start)} - ${formatDate(range.end)}`;
    };

    return (
        <div className="relative">
            {/* Quick Filter Buttons */}
            <div className="flex flex-wrap items-center gap-2">
                {presets.map((preset) => (
                    <button
                        key={preset.value}
                        onClick={() => handlePresetClick(preset.value)}
                        className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all ${
                            value === preset.value
                                ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg shadow-sky-500/25'
                                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-sky-500/50 hover:shadow-md'
                        }`}
                    >
                        <span>{preset.icon}</span>
                        <span className="text-sm">{preset.label}</span>
                    </button>
                ))}
            </div>

            {/* Custom Date Range Picker */}
            {showCustom && (
                <div className="absolute top-full left-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-4 z-50 min-w-[320px]">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="font-semibold text-gray-900 dark:text-white">Custom Range</h4>
                        <button
                            onClick={() => setShowCustom(false)}
                            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                Tanggal Mulai
                            </label>
                            <input
                                type="date"
                                value={customStart}
                                onChange={(e) => setCustomStart(e.target.value)}
                                max={customEnd || new Date().toISOString().split('T')[0]}
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                Tanggal Akhir
                            </label>
                            <input
                                type="date"
                                value={customEnd}
                                onChange={(e) => setCustomEnd(e.target.value)}
                                min={customStart}
                                max={new Date().toISOString().split('T')[0]}
                                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                            />
                        </div>

                        <button
                            onClick={handleCustomApply}
                            disabled={!customStart || !customEnd}
                            className="w-full px-4 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-medium rounded-lg transition-all disabled:cursor-not-allowed"
                        >
                            Terapkan
                        </button>
                    </div>
                </div>
            )}

            {/* Selected Range Display */}
            {value && (
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-medium">Range: </span>
                    {formatDateRange(value)}
                </div>
            )}
        </div>
    );
}
