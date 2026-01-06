import os from 'os';
import { query, queryOne } from '../database/database.js';
import mediaMtxService from '../services/mediaMtxService.js';

export async function getDashboardStats(request, reply) {
    try {
        const cameraStats = queryOne(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END) as disabled
            FROM cameras
        `);

        const areaCount = queryOne('SELECT COUNT(*) as count FROM areas').count;

        const mtxStats = await mediaMtxService.getStats();

        const cpusList = os.cpus();
        
        // Calculate CPU usage
        let cpuLoadPercent = 0;
        try {
            const getCPUTimes = () => {
                return os.cpus().reduce((acc, cpu) => {
                    acc.idle += cpu.times.idle;
                    acc.total += Object.values(cpu.times).reduce((a, b) => a + b, 0);
                    return acc;
                }, { idle: 0, total: 0 });
            };

            const startTimes = getCPUTimes();
            await new Promise(resolve => setTimeout(resolve, 100));
            const endTimes = getCPUTimes();

            const idleDelta = endTimes.idle - startTimes.idle;
            const totalDelta = endTimes.total - startTimes.total;
            cpuLoadPercent = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;
        } catch (e) {
            cpuLoadPercent = 0;
        }

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memUsagePercent = Math.round((usedMem / totalMem) * 100);

        const systemInfo = {
            platform: os.platform(),
            arch: os.arch(),
            cpus: cpusList.length,
            cpuModel: cpusList.length > 0 ? cpusList[0].model : 'Unknown CPU',
            cpuLoad: cpuLoadPercent,
            totalMem: totalMem,
            freeMem: freeMem,
            usedMem: usedMem,
            memUsagePercent: memUsagePercent,
            uptime: os.uptime(),
            loadAvg: os.loadavg(),
        };

        const sessions = mtxStats.sessions || [];
        const activeViewers = sessions.length;

        const activeStreams = (mtxStats.paths || []).map(p => {
            const cameraId = p.name.replace('camera', '');
            const cam = queryOne('SELECT name FROM cameras WHERE id = ?', [cameraId]);
            
            // Determine stream state
            let state = 'idle';
            if (p.sourceReady || p.ready) {
                state = 'ready';
            } else if (p.readers && p.readers.length > 0) {
                state = 'buffering';
            }
            
            return {
                id: cameraId,
                name: cam ? cam.name : p.name,
                ready: p.ready || false,
                state: state,
                viewers: (p.readers || []).length,
                bytesReceived: p.bytesReceived || 0,
                bytesSent: p.bytesSent || 0,
                // Debug info (can be removed in production)
                _debug: {
                    originalReaders: p._originalReaderCount || 0,
                    filteredReaders: p._filteredReaderCount || 0
                }
            };
        });

        const recentLogs = query(`
            SELECT l.*, u.username 
            FROM audit_logs l
            LEFT JOIN users u ON l.user_id = u.id
            ORDER BY l.created_at DESC
            LIMIT 10
        `).map(log => ({
            ...log,
            created_at_wib: new Intl.DateTimeFormat('id-ID', {
                timeZone: 'Asia/Jakarta',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).format(new Date(log.created_at + ' Z'))
        }));

        return reply.send({
            success: true,
            data: {
                summary: {
                    totalCameras: cameraStats.total,
                    activeCameras: cameraStats.active,
                    disabledCameras: cameraStats.disabled,
                    totalAreas: areaCount,
                    activeViewers: activeViewers,
                },
                system: systemInfo,
                streams: activeStreams,
                recentLogs: recentLogs,
                mtxConnected: !mtxStats.error
            }
        });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}
