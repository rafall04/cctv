import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Icons } from '../components/ui/Icons';

// Toast Component
function Toast({ message, type = 'info', onClose }) {
    useEffect(() => {
        const timer = setTimeout(onClose, 4000);
        return () => clearTimeout(timer);
    }, [onClose]);

    const styles = {
        info: {
            bg: 'bg-gradient-to-r from-primary to-primary-600',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        },
        success: {
            bg: 'bg-gradient-to-r from-emerald-500 to-teal-600',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        },
        warning: {
            bg: 'bg-gradient-to-r from-amber-500 to-orange-600',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
        },
        error: {
            bg: 'bg-gradient-to-r from-red-500 to-rose-600',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        },
    }[type];

    return (
        <div className={`${styles.bg} text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 animate-slide-down backdrop-blur-sm`}>
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                {styles.icon}
            </div>
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{message}</p>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-xl transition-colors shrink-0">
                <Icons.X />
            </button>
        </div>
    );
}

// Toast container for multiple toasts
function ToastContainer({ toasts, removeToast }) {
    if (toasts.length === 0) return null;
    return (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[1002] flex flex-col gap-3 w-full max-w-sm px-4">
            {toasts.map(toast => (
                <Toast key={toast.id} {...toast} onClose={() => removeToast(toast.id)} />
            ))}
        </div>
    );
}

const ToastContext = createContext({});

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((message, type = 'info') => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev, { id, message, type }]);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ addToast }}>
            {children}
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </ToastContext.Provider>
    );
}

export function useToast() {
    return useContext(ToastContext);
}
