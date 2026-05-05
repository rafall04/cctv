/*
 * Purpose: Own admin viewer analytics filter state and reset pagination when filters change.
 * Caller: ViewerAnalytics page.
 * Deps: React hooks and TimezoneContext date helper.
 * MainFuncs: useViewerAnalyticsFilters.
 * SideEffects: None.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLocalDateInputValue, useTimezone } from '../../contexts/TimezoneContext';

export function useViewerAnalyticsFilters() {
    const { timezone } = useTimezone();
    const initialCustomDate = getLocalDateInputValue(new Date(), timezone);
    const defaultCustomDateRef = useRef(initialCustomDate);
    const [period, setPeriod] = useState('7days');
    const [customDate, setCustomDate] = useState(initialCustomDate);
    const [selectedCamera, setSelectedCamera] = useState('');
    const [selectedDate, setSelectedDate] = useState(null);
    const [showDailyDetail, setShowDailyDetail] = useState(false);
    const [heatmapCell, setHeatmapCell] = useState(null);
    const [showHeatmapDetail, setShowHeatmapDetail] = useState(false);
    const [sessionsPage, setSessionsPage] = useState(1);

    useEffect(() => {
        const nextDefaultDate = getLocalDateInputValue(new Date(), timezone);
        setCustomDate((currentDate) => (
            currentDate === defaultCustomDateRef.current ? nextDefaultDate : currentDate
        ));
        defaultCustomDateRef.current = nextDefaultDate;
    }, [timezone]);

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
