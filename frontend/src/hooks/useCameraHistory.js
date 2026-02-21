import { useState, useEffect, useCallback } from 'react';

const FAVORITES_KEY = 'cctv_favorites';
const RECENT_KEY = 'cctv_recent';
const MAX_RECENT = 5;

function getFromStorage(key, defaultValue) {
    try {
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : defaultValue;
    } catch {
        return defaultValue;
    }
}

function setToStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn('Failed to save to localStorage:', e);
    }
}

export function useCameraHistory() {
    const [favorites, setFavorites] = useState(() => 
        getFromStorage(FAVORITES_KEY, [])
    );
    const [recentCameras, setRecentCameras] = useState(() => 
        getFromStorage(RECENT_KEY, [])
    );

    const addFavorite = useCallback((cameraId) => {
        setFavorites(prev => {
            if (prev.includes(cameraId)) return prev;
            const newFavorites = [...prev, cameraId];
            setToStorage(FAVORITES_KEY, newFavorites);
            return newFavorites;
        });
    }, []);

    const removeFavorite = useCallback((cameraId) => {
        setFavorites(prev => {
            const newFavorites = prev.filter(id => id !== cameraId);
            setToStorage(FAVORITES_KEY, newFavorites);
            return newFavorites;
        });
    }, []);

    const toggleFavorite = useCallback((cameraId) => {
        setFavorites(prev => {
            const isFavorite = prev.includes(cameraId);
            const newFavorites = isFavorite 
                ? prev.filter(id => id !== cameraId)
                : [...prev, cameraId];
            setToStorage(FAVORITES_KEY, newFavorites);
            return newFavorites;
        });
    }, []);

    const isFavorite = useCallback((cameraId) => {
        return favorites.includes(cameraId);
    }, [favorites]);

    const addRecentCamera = useCallback((camera) => {
        if (!camera || !camera.id) return;
        
        setRecentCameras(prev => {
            const filtered = prev.filter(c => c.id !== camera.id);
            const newRecent = [camera, ...filtered].slice(0, MAX_RECENT);
            setToStorage(RECENT_KEY, newRecent);
            return newRecent;
        });
    }, []);

    const clearRecentCameras = useCallback(() => {
        setRecentCameras([]);
        setToStorage(RECENT_KEY, []);
    }, []);

    return {
        favorites,
        recentCameras,
        addFavorite,
        removeFavorite,
        toggleFavorite,
        isFavorite,
        addRecentCamera,
        clearRecentCameras
    };
}
