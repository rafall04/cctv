import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { streamService } from '../services/streamService';
import { areaService } from '../services/areaService';
import { detectDeviceTier } from '../utils/deviceDetector';

const CameraContext = createContext(null);

export function CameraProvider({ children, autoRefresh = true }) {
    const [cameras, setCameras] = useState([]);
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [deviceTier] = useState(() => detectDeviceTier());

    const fetchInitialData = useCallback(async () => {
        setLoading(true);
        try {
            setError(null);
            const [camsRes, areasRes] = await Promise.all([
                streamService.getAllActiveStreams().catch(err => {
                    console.error('Failed to fetch streams', err);
                    return { success: false, data: [] };
                }),
                areaService.getPublicAreas().catch(err => {
                    console.error('Failed to fetch areas', err);
                    return { success: false, data: [] };
                })
            ]);

            if (camsRes.data) {
                setCameras(camsRes.data);
            }
            if (areasRes.data) {
                setAreas(areasRes.data);
            }
            return {
                cameras: camsRes.data || [],
                areas: areasRes.data || []
            };
        } catch (err) {
            console.error('Failed to fetch camera and area data:', err);
            setError(err);
            return { cameras: [], areas: [] };
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial fetch
    useEffect(() => {
        fetchInitialData();
    }, [fetchInitialData]);

    // Background refresh
    useEffect(() => {
        if (!autoRefresh) return;

        const refreshMs = deviceTier === 'low' ? 60000 : deviceTier === 'high' ? 15000 : 30000;
        const refreshInterval = setInterval(async () => {
            try {
                const camsRes = await streamService.getAllActiveStreams();
                if (camsRes.data) {
                    setCameras(camsRes.data);
                }
            } catch (err) {
                console.warn('Background refresh failed:', err);
            }
        }, refreshMs);

        return () => clearInterval(refreshInterval);
    }, [deviceTier, autoRefresh]);

    const value = {
        cameras,
        areas,
        loading,
        error,
        deviceTier,
        refreshData: fetchInitialData
    };

    return (
        <CameraContext.Provider value={value}>
            {children}
        </CameraContext.Provider>
    );
}

export function useCameras() {
    const context = useContext(CameraContext);
    if (!context) {
        throw new Error('useCameras must be used within a CameraProvider');
    }
    return context;
}
