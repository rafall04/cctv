import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';

export function useSmartParams() {
    const [searchParams, setSearchParams] = useSearchParams();

    const updateParam = useCallback((key, value) => {
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            newParams.set(key, value);
            return newParams;
        }, { replace: true });
    }, [setSearchParams]);

    const removeParam = useCallback((key) => {
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            newParams.delete(key);
            return newParams;
        }, { replace: true });
    }, [setSearchParams]);

    const removeParams = useCallback((keys) => {
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            keys.forEach(k => newParams.delete(k));
            return newParams;
        }, { replace: true });
    }, [setSearchParams]);

    const getParam = useCallback((key) => {
        return searchParams.get(key);
    }, [searchParams]);

    return { searchParams, updateParam, removeParam, removeParams, getParam };
}
