/*
 * Purpose: Provide configured timezone formatting helpers across public and admin routes.
 * Caller: App provider tree and pages/components that display backend timestamps.
 * Deps: React context/hooks and admin settings API.
 * MainFuncs: TimezoneProvider, useTimezone, parseBackendDateInput, TIMESTAMP_STORAGE.
 * SideEffects: Loads timezone setting from backend and formats display-only timestamps.
 */

import { createContext, useContext, useState, useEffect } from 'react';
import { adminAPI } from '../services/api';

const TimezoneContext = createContext();

const SQLITE_BARE_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
export const TIMESTAMP_STORAGE = {
    AUTO: 'auto',
    UTC_SQL: 'utc_sql',
    LOCAL_SQL: 'local_sql',
};

function splitDateFormatOptions(options = {}) {
    const { storage = TIMESTAMP_STORAGE.AUTO, ...formatOptions } = options;
    return { storage, formatOptions };
}

export function parseBackendDateInput(date, { storage = TIMESTAMP_STORAGE.AUTO } = {}) {
    if (typeof date !== 'string') {
        return date;
    }

    const value = date.trim();
    if (storage === TIMESTAMP_STORAGE.UTC_SQL && SQLITE_BARE_DATETIME_PATTERN.test(value)) {
        return new Date(`${value.replace(' ', 'T')}Z`);
    }

    if (SQLITE_BARE_DATETIME_PATTERN.test(value)) {
        return new Date(value.replace(' ', 'T'));
    }

    return new Date(value);
}

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
        const { storage, formatOptions } = splitDateFormatOptions(options);
        const dateObj = parseBackendDateInput(date, { storage });
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            ...formatOptions
        }).format(dateObj);
    };

    const formatDate = (date, options = {}) => {
        const { storage, formatOptions } = splitDateFormatOptions(options);
        const dateObj = parseBackendDateInput(date, { storage });
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            ...formatOptions
        }).format(dateObj);
    };

    const formatTime = (date, options = {}) => {
        const { storage, formatOptions } = splitDateFormatOptions(options);
        const dateObj = parseBackendDateInput(date, { storage });
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            ...formatOptions
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
