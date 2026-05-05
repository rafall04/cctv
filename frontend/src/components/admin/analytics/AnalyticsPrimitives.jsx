/*
 * Purpose: Provide reusable admin viewer analytics controls, cards, badges, charts, and pagination primitives.
 * Caller: ViewerAnalytics and related admin analytics presentation sections.
 * Deps: React state, TimezoneContext, TrendIndicator, viewer analytics adapter.
 * MainFuncs: PeriodSelector, CameraFilter, ActiveViewerCard, chart components, Pagination, formatting re-exports.
 * SideEffects: None.
 */

import { useState } from 'react';
import { TrendBadge } from '../../TrendIndicator';
import { formatDuration, formatWatchTime } from '../../../utils/admin/viewerAnalyticsAdapter';
import { getLocalDateInputValue, useTimezone } from '../../../contexts/TimezoneContext';

export function DeviceIcon({ type, className = 'w-4 h-4' }) {
    if (type === 'mobile') {
        return (
            <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
        );
    }

    if (type === 'tablet') {
        return (
            <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
        );
    }

    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
    );
}

export function StatsCard({ icon, label, value, subValue, color = 'sky', trend }) {
    const colorClasses = {
        sky: 'from-primary-400 to-primary-600 shadow-primary/30',
        purple: 'from-purple-400 to-purple-600 shadow-purple-500/30',
        emerald: 'from-emerald-400 to-emerald-600 shadow-emerald-500/30',
        amber: 'from-amber-400 to-amber-600 shadow-amber-500/30',
        rose: 'from-rose-400 to-rose-600 shadow-rose-500/30',
    };

    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-lg transition-all group">
            <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 bg-gradient-to-br ${colorClasses[color]} rounded-xl flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform`}>
                    {icon}
                </div>
                <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</span>
            </div>
            <div className="flex items-baseline gap-2 mb-1">
                <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{value}</h3>
                {trend !== null && trend !== undefined && <TrendBadge value={trend} />}
            </div>
            {subValue && <p className="text-sm text-gray-500 dark:text-gray-400">{subValue}</p>}
        </div>
    );
}

export function PeriodSelector({ value, onChange, customDate, onCustomDateChange }) {
    const [showDatePicker, setShowDatePicker] = useState(false);
    const { timezone } = useTimezone();
    const periods = [
        { value: 'today', label: 'Hari Ini' },
        { value: 'yesterday', label: 'Kemarin' },
        { value: '7days', label: '7 Hari' },
        { value: '30days', label: '30 Hari' },
        { value: 'custom', label: 'Pilih Tanggal' },
    ];

    return (
        <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
                {periods.map((period) => (
                    <button
                        key={period.value}
                        onClick={() => {
                            if (period.value === 'custom') {
                                setShowDatePicker(!showDatePicker);
                            } else {
                                onChange(period.value);
                                setShowDatePicker(false);
                            }
                        }}
                        className={`px-3 py-2 text-sm font-medium rounded-lg transition-all ${value === period.value ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white'}`}
                    >
                        {period.label}
                    </button>
                ))}
            </div>
            {(showDatePicker || value === 'custom') && (
                <input
                    type="date"
                    value={customDate}
                    onChange={(event) => {
                        onCustomDateChange(event.target.value);
                        onChange('custom');
                    }}
                    max={getLocalDateInputValue(new Date(), timezone)}
                    className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent"
                />
            )}
        </div>
    );
}

export function CameraFilter({ cameras, value, onChange }) {
    return (
        <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent"
        >
            <option value="">Semua Kamera</option>
            {cameras.map((camera) => (
                <option key={camera.camera_id} value={camera.camera_id}>
                    {camera.camera_name}
                </option>
            ))}
        </select>
    );
}

export function ActiveViewerCard({ session }) {
    return (
        <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                session.deviceType === 'mobile' ? 'bg-blue-100 dark:bg-primary/20 text-primary' :
                session.deviceType === 'tablet' ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-500' :
                'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
            }`}>
                <DeviceIcon type={session.deviceType} className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white truncate">{session.ipAddress}</span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">LIVE</span>
                    </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    Kamera {session.cameraName} • Durasi {formatDuration(session.durationSeconds)}
                </p>
            </div>
        </div>
    );
}

export function InteractiveBarChart({ data, maxValue, onBarClick, selectedDate }) {
    if (!data || data.length === 0) {
        return <div className="flex items-center justify-center h-48 text-gray-500 dark:text-gray-400">Tidak ada data</div>;
    }

    const max = maxValue || Math.max(...data.map((item) => item.value), 1);

    return (
        <div className="space-y-2">
            {data.map((item, index) => (
                <div
                    key={`${item.rawDate}-${index}`}
                    className={`flex items-center gap-3 p-1 rounded-lg cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-800/50 ${selectedDate === item.rawDate ? 'bg-sky-50 dark:bg-primary/10 ring-1 ring-primary/30' : ''}`}
                    onClick={() => onBarClick(item)}
                >
                    <span className="text-xs text-gray-600 dark:text-gray-300 w-16 text-right truncate">{item.label}</span>
                    <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
                        <div
                            className={`h-full rounded-lg transition-all duration-500 ${selectedDate === item.rawDate ? 'bg-gradient-to-r from-primary-400 to-primary' : 'bg-gradient-to-r from-primary to-primary-600'}`}
                            style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
                        />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-12">{item.value}</span>
                </div>
            ))}
        </div>
    );
}

export function SimpleBarChart({ data, maxValue }) {
    if (!data || data.length === 0) {
        return <div className="flex items-center justify-center h-48 text-gray-500 dark:text-gray-400">Tidak ada data</div>;
    }

    const max = maxValue || Math.max(...data.map((item) => item.value), 1);

    return (
        <div className="space-y-2">
            {data.map((item, index) => (
                <div key={`${item.label}-${index}`} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 dark:text-gray-300 w-16 text-right truncate">{item.label}</span>
                    <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-primary to-primary-600 rounded-lg transition-all duration-500" style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-12">{item.value}</span>
                </div>
            ))}
        </div>
    );
}

export function Pagination({ currentPage, totalPages, onPageChange }) {
    if (totalPages <= 1) {
        return null;
    }

    const pages = [];
    const maxVisible = 5;
    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);

    if (end - start + 1 < maxVisible) {
        start = Math.max(1, end - maxVisible + 1);
    }

    for (let page = start; page <= end; page += 1) {
        pages.push(page);
    }

    return (
        <div className="flex items-center justify-center gap-1 mt-4">
            <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            {start > 1 && (
                <>
                    <button onClick={() => onPageChange(1)} className="px-3 py-1 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">1</button>
                    {start > 2 && <span className="px-2 text-gray-500 dark:text-gray-400">...</span>}
                </>
            )}
            {pages.map((page) => (
                <button
                    key={page}
                    onClick={() => onPageChange(page)}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${page === currentPage ? 'bg-primary text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`}
                >
                    {page}
                </button>
            ))}
            {end < totalPages && (
                <>
                    {end < totalPages - 1 && <span className="px-2 text-gray-500 dark:text-gray-400">...</span>}
                    <button onClick={() => onPageChange(totalPages)} className="px-3 py-1 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">{totalPages}</button>
                </>
            )}
            <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
        </div>
    );
}

export { formatDuration, formatWatchTime };
