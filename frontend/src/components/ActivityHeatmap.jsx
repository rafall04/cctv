import { useState, useMemo } from 'react';

/**
 * Activity Heatmap Component
 * Menampilkan heatmap aktivitas 24 jam x 7 hari
 * 
 * Features:
 * - Color gradient: hijau (sepi) → kuning (sedang) → merah (ramai)
 * - Tooltip showing exact viewer count
 * - Click untuk drill-down ke detail
 * - Responsive untuk mobile
 */
export function ActivityHeatmap({ data, onCellClick }) {
    const [hoveredCell, setHoveredCell] = useState(null);

    // Nama hari dalam Bahasa Indonesia
    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const dayNamesShort = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

    // Process data menjadi matrix 7 hari x 24 jam
    const heatmapMatrix = useMemo(() => {
        if (!data || data.length === 0) return null;

        // Initialize matrix dengan 0
        const matrix = Array(7).fill(null).map(() => Array(24).fill(0));
        const uniqueVisitorsMatrix = Array(7).fill(null).map(() => Array(24).fill(0));

        // Fill matrix dengan data
        data.forEach(item => {
            const day = parseInt(item.day_of_week); // 0-6 (Sunday-Saturday)
            const hour = parseInt(item.hour); // 0-23
            matrix[day][hour] = item.sessions;
            uniqueVisitorsMatrix[day][hour] = item.unique_visitors;
        });

        return { sessions: matrix, uniqueVisitors: uniqueVisitorsMatrix };
    }, [data]);

    // Hitung max value untuk color scaling
    const maxSessions = useMemo(() => {
        if (!heatmapMatrix) return 1;
        return Math.max(...heatmapMatrix.sessions.flat(), 1);
    }, [heatmapMatrix]);

    // Get color based on session count
    const getColor = (sessions) => {
        if (sessions === 0) return 'bg-gray-100 dark:bg-gray-800';
        
        const intensity = sessions / maxSessions;
        
        if (intensity < 0.2) return 'bg-emerald-100 dark:bg-emerald-500/20';
        if (intensity < 0.4) return 'bg-green-200 dark:bg-green-500/30';
        if (intensity < 0.6) return 'bg-yellow-200 dark:bg-yellow-500/40';
        if (intensity < 0.8) return 'bg-orange-300 dark:bg-orange-500/50';
        return 'bg-red-400 dark:bg-red-500/60';
    };

    // Get text color for contrast
    const getTextColor = (sessions) => {
        if (sessions === 0) return 'text-gray-400 dark:text-gray-600';
        
        const intensity = sessions / maxSessions;
        
        if (intensity < 0.6) return 'text-gray-700 dark:text-gray-300';
        return 'text-white dark:text-white';
    };

    if (!heatmapMatrix) {
        return (
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Activity Heatmap</h2>
                <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
                    <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    <p className="text-sm">Belum ada data aktivitas</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-pink-500 rounded-xl flex items-center justify-center text-white shadow-lg">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Activity Heatmap</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Pola aktivitas per jam dan hari</p>
                    </div>
                </div>
            </div>

            {/* Desktop View */}
            <div className="hidden lg:block overflow-x-auto">
                <div className="inline-block min-w-full">
                    {/* Hour labels */}
                    <div className="flex mb-2">
                        <div className="w-20 flex-shrink-0"></div>
                        <div className="flex gap-1">
                            {Array.from({ length: 24 }, (_, i) => (
                                <div key={i} className="w-10 text-center">
                                    <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                                        {i.toString().padStart(2, '0')}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Heatmap grid */}
                    {heatmapMatrix.sessions.map((dayData, dayIndex) => (
                        <div key={dayIndex} className="flex items-center gap-1 mb-1">
                            {/* Day label */}
                            <div className="w-20 flex-shrink-0 text-right pr-3">
                                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                    {dayNames[dayIndex]}
                                </span>
                            </div>
                            
                            {/* Hour cells */}
                            <div className="flex gap-1">
                                {dayData.map((sessions, hourIndex) => (
                                    <div
                                        key={hourIndex}
                                        className={`w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer transition-all hover:scale-110 hover:shadow-lg ${getColor(sessions)} ${
                                            hoveredCell?.day === dayIndex && hoveredCell?.hour === hourIndex
                                                ? 'ring-2 ring-sky-500 ring-offset-2 dark:ring-offset-gray-900'
                                                : ''
                                        }`}
                                        onMouseEnter={() => setHoveredCell({ day: dayIndex, hour: hourIndex })}
                                        onMouseLeave={() => setHoveredCell(null)}
                                        onClick={() => onCellClick && onCellClick({ day: dayIndex, hour: hourIndex, sessions, uniqueVisitors: heatmapMatrix.uniqueVisitors[dayIndex][hourIndex] })}
                                    >
                                        <span className={`text-[10px] font-bold ${getTextColor(sessions)}`}>
                                            {sessions > 0 ? sessions : ''}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Mobile View - Simplified */}
            <div className="lg:hidden">
                <div className="space-y-3">
                    {heatmapMatrix.sessions.map((dayData, dayIndex) => {
                        const dayTotal = dayData.reduce((sum, val) => sum + val, 0);
                        const peakHour = dayData.indexOf(Math.max(...dayData));
                        
                        return (
                            <div key={dayIndex} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                        {dayNames[dayIndex]}
                                    </span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                        {dayTotal} sesi
                                    </span>
                                </div>
                                <div className="flex gap-0.5">
                                    {dayData.map((sessions, hourIndex) => (
                                        <div
                                            key={hourIndex}
                                            className={`flex-1 h-8 rounded ${getColor(sessions)}`}
                                            onClick={() => onCellClick && onCellClick({ day: dayIndex, hour: hourIndex, sessions, uniqueVisitors: heatmapMatrix.uniqueVisitors[dayIndex][hourIndex] })}
                                        />
                                    ))}
                                </div>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                                    Peak: {peakHour.toString().padStart(2, '0')}:00 ({Math.max(...dayData)} sesi)
                                </p>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Tooltip */}
            {hoveredCell && (
                <div className="mt-4 p-3 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-500/10 dark:to-pink-500/10 rounded-lg border border-purple-100 dark:border-purple-500/20">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                {dayNames[hoveredCell.day]}, {hoveredCell.hour.toString().padStart(2, '0')}:00
                            </p>
                            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                                {heatmapMatrix.sessions[hoveredCell.day][hoveredCell.hour]} sesi • {' '}
                                {heatmapMatrix.uniqueVisitors[hoveredCell.day][hoveredCell.hour]} pengunjung unik
                            </p>
                        </div>
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${getColor(heatmapMatrix.sessions[hoveredCell.day][hoveredCell.hour])}`}>
                            <span className={`text-lg font-bold ${getTextColor(heatmapMatrix.sessions[hoveredCell.day][hoveredCell.hour])}`}>
                                {heatmapMatrix.sessions[hoveredCell.day][hoveredCell.hour]}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Legend */}
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Intensitas:</span>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Sepi</span>
                        <div className="flex gap-1">
                            <div className="w-6 h-6 rounded bg-emerald-100 dark:bg-emerald-500/20"></div>
                            <div className="w-6 h-6 rounded bg-green-200 dark:bg-green-500/30"></div>
                            <div className="w-6 h-6 rounded bg-yellow-200 dark:bg-yellow-500/40"></div>
                            <div className="w-6 h-6 rounded bg-orange-300 dark:bg-orange-500/50"></div>
                            <div className="w-6 h-6 rounded bg-red-400 dark:bg-red-500/60"></div>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Ramai</span>
                    </div>
                </div>
            </div>

            {/* Insight */}
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-500/10 rounded-lg border border-blue-100 dark:border-blue-500/20">
                <p className="text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-semibold text-blue-600 dark:text-blue-400">💡 Tip:</span>
                    {' '}
                    Gunakan heatmap ini untuk menentukan waktu maintenance optimal (pilih jam dengan aktivitas rendah).
                    Klik pada cell untuk melihat detail lebih lanjut.
                </p>
            </div>
        </div>
    );
}

/**
 * Heatmap Detail Modal - untuk drill-down
 */
export function HeatmapDetailModal({ cellData, onClose }) {
    if (!cellData) return null;

    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-gray-200 dark:border-gray-800">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                {dayNames[cellData.day]}
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                Jam {cellData.hour.toString().padStart(2, '0')}:00 - {(cellData.hour + 1).toString().padStart(2, '0')}:00
                            </p>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div className="p-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-500/10 dark:to-blue-500/10 rounded-xl p-4 border border-sky-100 dark:border-sky-500/20">
                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Sesi</p>
                            <p className="text-3xl font-bold text-gray-900 dark:text-white">{cellData.sessions}</p>
                        </div>
                        <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-500/10 dark:to-pink-500/10 rounded-xl p-4 border border-purple-100 dark:border-purple-500/20">
                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Pengunjung Unik</p>
                            <p className="text-3xl font-bold text-gray-900 dark:text-white">{cellData.uniqueVisitors}</p>
                        </div>
                    </div>
                    
                    <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-500/10 rounded-lg border border-amber-100 dark:border-amber-500/20">
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                            <span className="font-semibold text-amber-600 dark:text-amber-400">⚡ Rekomendasi:</span>
                            {' '}
                            {cellData.sessions < 5 
                                ? 'Waktu ideal untuk maintenance atau update sistem.'
                                : cellData.sessions < 20
                                ? 'Aktivitas sedang. Pertimbangkan untuk maintenance jika urgent.'
                                : 'Jam sibuk! Hindari maintenance pada waktu ini.'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
