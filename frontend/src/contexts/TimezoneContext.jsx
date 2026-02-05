import { createContext, useContext, useState, useEffect } from 'react';
import { adminAPI } from '../services/api';

const TimezoneContext = createContext();

export function TimezoneProvider({ children }) {
    const [timezone, setTimezone] = useState('Asia/Jakarta'); // Default
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadTimezone();
    }, []);

    const loadTimezone = async () => {
        try {
            const { data } = await adminAPI.get('/api/admin/settings/timezone');
            setTimezone(data.data.timezone);
        } catch (error) {
            console.error('Failed to load timezone:', error);
            // Keep default
        } finally {
            setLoading(false);
        }
    };

    const formatDateTime = (date, options = {}) => {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            ...options
        }).format(dateObj);
    };

    const formatDate = (date, options = {}) => {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            ...options
        }).format(dateObj);
    };

    const formatTime = (date, options = {}) => {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            ...options
        }).format(dateObj);
    };

    return (
        <TimezoneContext.Provider value={{ 
            timezone, 
            loading,
            formatDateTime,
            formatDate,
            formatTime,
            refreshTimezone: loadTimezone
        }}>
            {children}
        </TimezoneContext.Provider>
    );
}

export function useTimezone() {
    const context = useContext(TimezoneContext);
    if (!context) {
        throw new Error('useTimezone must be used within TimezoneProvider');
    }
    return context;
}
