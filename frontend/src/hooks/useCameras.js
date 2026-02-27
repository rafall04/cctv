import { useState, useEffect } from 'react';
import apiClient from '../services/apiClient';

let globalCamerasCache = null;
let globalCamerasPromise = null;

export function useCameras() {
    const [cameras, setCameras] = useState(globalCamerasCache || []);
    const [loading, setLoading] = useState(!globalCamerasCache);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;

        if (globalCamerasCache) {
            if (isMounted) {
                setCameras(globalCamerasCache);
                setLoading(false);
            }
            return;
        }

        if (!globalCamerasPromise) {
            globalCamerasPromise = apiClient.get('/api/cameras/active')
                .then(res => {
                    globalCamerasCache = res.data.data || res.data;
                    return globalCamerasCache;
                })
                .catch(err => {
                    globalCamerasPromise = null; // reset so next try works
                    throw err;
                });
        }

        globalCamerasPromise
            .then(data => {
                if (isMounted) {
                    setCameras(data);
                    setLoading(false);
                }
            })
            .catch(err => {
                if (isMounted) {
                    setError('Gagal memuat data kamera');
                    setLoading(false);
                }
            });

        return () => { isMounted = false; };
    }, []);

    return { cameras, loading, error };
}
