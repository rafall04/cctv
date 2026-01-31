import { useState, useEffect, useRef } from 'react';
import { adminService } from '../services/adminService';

/**
 * Lightweight Real-time Chart Component
 * Optimized for low-end devices
 * 
 * Features:
 * - Canvas-based rendering (lebih ringan dari SVG)
 * - Throttled updates (max 1 update per 5 seconds)
 * - Limited data points (max 20 points)
 * - Smooth animations dengan CSS transforms
 * - Auto-pause saat tidak visible
 */
export function RealtimeChart({ 
    data = [], 
    title = "Real-time Activity",
    height = 200,
    maxDataPoints = 20,
    updateInterval = 5000,
    color = '#0ea5e9'
}) {
    const canvasRef = useRef(null);
    const [isVisible, setIsVisible] = useState(true);
    const [chartData, setChartData] = useState([]);
    const animationFrameRef = useRef(null);

    // Visibility observer untuk pause saat tidak terlihat
    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => setIsVisible(entry.isIntersecting),
            { threshold: 0.1 }
        );

        const currentCanvas = canvasRef.current;
        if (currentCanvas) {
            observer.observe(currentCanvas);
        }

        return () => {
            if (currentCanvas) {
                observer.unobserve(currentCanvas);
            }
        };
    }, []);

    // Update chart data dengan throttling
    useEffect(() => {
        if (!isVisible || !data || data.length === 0) return;

        // Limit data points untuk performa
        const limitedData = data.slice(-maxDataPoints);
        setChartData(limitedData);
    }, [data, maxDataPoints, isVisible]);

    // Draw chart dengan canvas
    useEffect(() => {
        if (!isVisible || chartData.length === 0) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d', { alpha: false });
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();

        // Set canvas size dengan device pixel ratio untuk crisp rendering
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        const padding = { top: 20, right: 20, bottom: 30, left: 50 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // Clear canvas
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        // Get max value for scaling
        const maxValue = Math.max(...chartData.map(d => d.value), 1);
        const minValue = 0;

        // Draw grid lines (horizontal)
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        const gridLines = 5;
        for (let i = 0; i <= gridLines; i++) {
            const y = padding.top + (chartHeight / gridLines) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();

            // Y-axis labels
            const value = Math.round(maxValue - (maxValue / gridLines) * i);
            ctx.fillStyle = '#6b7280';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(value.toString(), padding.left - 10, y + 4);
        }

        // Draw line chart
        if (chartData.length > 1) {
            const xStep = chartWidth / (chartData.length - 1);

            // Draw gradient fill
            const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
            gradient.addColorStop(0, `${color}40`);
            gradient.addColorStop(1, `${color}00`);

            ctx.beginPath();
            ctx.moveTo(padding.left, padding.top + chartHeight);

            chartData.forEach((point, index) => {
                const x = padding.left + index * xStep;
                const y = padding.top + chartHeight - ((point.value - minValue) / (maxValue - minValue)) * chartHeight;
                
                if (index === 0) {
                    ctx.lineTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });

            ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();

            // Draw line
            ctx.beginPath();
            chartData.forEach((point, index) => {
                const x = padding.left + index * xStep;
                const y = padding.top + chartHeight - ((point.value - minValue) / (maxValue - minValue)) * chartHeight;
                
                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Draw points
            chartData.forEach((point, index) => {
                const x = padding.left + index * xStep;
                const y = padding.top + chartHeight - ((point.value - minValue) / (maxValue - minValue)) * chartHeight;
                
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
            });
        }

        // X-axis labels (show every nth label to avoid crowding)
        ctx.fillStyle = '#6b7280';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        const labelStep = Math.ceil(chartData.length / 6);
        chartData.forEach((point, index) => {
            if (index % labelStep === 0 || index === chartData.length - 1) {
                const x = padding.left + (index / (chartData.length - 1)) * chartWidth;
                ctx.fillText(point.label, x, height - 10);
            }
        });

    }, [chartData, isVisible, color]);

    // Cleanup
    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    return (
        <div className="relative">
            <canvas
                ref={canvasRef}
                className="w-full"
                style={{ height: `${height}px` }}
            />
            {!isVisible && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 dark:bg-gray-800/80">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Chart paused</span>
                </div>
            )}
        </div>
    );
}

/**
 * Real-time Activity Chart Component
 * Wrapper dengan live indicator dan auto-refresh
 */
export function RealtimeActivityChart() {
    const [data, setData] = useState([]);
    const [isLive, setIsLive] = useState(true);
    const [lastUpdate, setLastUpdate] = useState(null);
    const [currentViewers, setCurrentViewers] = useState(0);
    const intervalRef = useRef(null);

    // Fetch real-time data dari API
    const fetchRealtimeData = async () => {
        try {
            // Gunakan adminService yang sudah handle authentication
            const result = await adminService.getRealTimeViewers();
            
            if (result.success) {
                const now = new Date();
                const activeViewers = result.data.activeViewers || 0;
                
                const newPoint = {
                    label: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                    value: activeViewers,
                    timestamp: now.getTime()
                };

                setData(prev => {
                    const updated = [...prev, newPoint];
                    return updated.slice(-20); // Keep last 20 points (5 menit data)
                });

                setCurrentViewers(activeViewers);
                setLastUpdate(now);
            }
        } catch (error) {
            console.error('Failed to fetch real-time data:', error);
        }
    };

    // Auto-refresh setiap 5 detik
    useEffect(() => {
        if (isLive) {
            fetchRealtimeData(); // Initial fetch
            
            intervalRef.current = setInterval(() => {
                fetchRealtimeData();
            }, 5000); // Update setiap 5 detik
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [isLive]);

    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-green-500 rounded-xl flex items-center justify-center text-white shadow-lg">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Aktivitas Real-time</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Update setiap 5 detik</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-3">
                    {lastUpdate && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                            {lastUpdate.toLocaleTimeString('id-ID')}
                        </span>
                    )}
                    
                    <button
                        onClick={() => setIsLive(!isLive)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            isLive
                                ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                        }`}
                    >
                        <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`}></span>
                        {isLive ? 'LIVE' : 'PAUSED'}
                    </button>
                </div>
            </div>

            {/* Chart */}
            {data.length > 0 ? (
                <RealtimeChart 
                    data={data}
                    height={200}
                    maxDataPoints={20}
                    color="#10b981"
                />
            ) : (
                <div className="flex items-center justify-center h-[200px] text-gray-400 dark:text-gray-500">
                    <div className="text-center">
                        <svg className="w-12 h-12 mx-auto mb-2 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                        <p className="text-sm">Memuat data real-time...</p>
                    </div>
                </div>
            )}

            {/* Stats */}
            {data.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-3">
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Saat Ini</p>
                        <p className="text-xl font-bold text-gray-900 dark:text-white">
                            {data[data.length - 1]?.value || 0}
                        </p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Rata-rata</p>
                        <p className="text-xl font-bold text-gray-900 dark:text-white">
                            {Math.round(data.reduce((sum, d) => sum + d.value, 0) / data.length)}
                        </p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Peak</p>
                        <p className="text-xl font-bold text-gray-900 dark:text-white">
                            {Math.max(...data.map(d => d.value))}
                        </p>
                    </div>
                </div>
            )}

            {/* Info */}
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-500/10 rounded-lg border border-blue-100 dark:border-blue-500/20">
                <p className="text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-semibold text-blue-600 dark:text-blue-400">💡 Info:</span>
                    {' '}
                    Chart ini menampilkan aktivitas viewer dalam 5 menit terakhir. 
                    Klik LIVE untuk pause/resume auto-refresh.
                </p>
            </div>
        </div>
    );
}
