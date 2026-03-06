import { useCallback, useState } from 'react';

export function useViewerAnalyticsFilters() {
    const [period, setPeriod] = useState('7days');
    const [customDate, setCustomDate] = useState(new Date().toISOString().split('T')[0]);
    const [selectedCamera, setSelectedCamera] = useState('');
    const [selectedDate, setSelectedDate] = useState(null);
    const [showDailyDetail, setShowDailyDetail] = useState(false);
    const [heatmapCell, setHeatmapCell] = useState(null);
    const [showHeatmapDetail, setShowHeatmapDetail] = useState(false);
    const [sessionsPage, setSessionsPage] = useState(1);

    const selectCamera = useCallback((cameraId) => {
        setSelectedCamera(cameraId);
        setSessionsPage(1);
    }, []);

    const selectPeriod = useCallback((nextPeriod) => {
        setPeriod(nextPeriod);
        setSessionsPage(1);
    }, []);

    const selectCustomDate = useCallback((date) => {
        setCustomDate(date);
        setSessionsPage(1);
    }, []);

    const openDailyDetail = useCallback((date) => {
        setSelectedDate(date);
        setShowDailyDetail(true);
    }, []);

    const closeDailyDetail = useCallback(() => {
        setSelectedDate(null);
        setShowDailyDetail(false);
    }, []);

    const openHeatmapDetail = useCallback((cell) => {
        setHeatmapCell(cell);
        setShowHeatmapDetail(true);
    }, []);

    const closeHeatmapDetail = useCallback(() => {
        setHeatmapCell(null);
        setShowHeatmapDetail(false);
    }, []);

    return {
        period,
        customDate,
        selectedCamera,
        selectedDate,
        showDailyDetail,
        heatmapCell,
        showHeatmapDetail,
        sessionsPage,
        setSessionsPage,
        selectCamera,
        selectPeriod,
        selectCustomDate,
        openDailyDetail,
        closeDailyDetail,
        openHeatmapDetail,
        closeHeatmapDetail,
    };
}

export default useViewerAnalyticsFilters;
