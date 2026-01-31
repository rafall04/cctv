import { Component } from 'react';

/**
 * Error Boundary Component
 * Catches JavaScript errors anywhere in the child component tree
 * Requirements: Phase 1 Task 3 - Add error boundaries untuk better error handling
 */
class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
            errorCount: 0
        };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        // Log error to console in development
        if (import.meta.env.DEV) {
            console.error('Error caught by boundary:', error);
            console.error('Error info:', errorInfo);
        }

        // Update state with error details
        this.setState(prevState => ({
            error,
            errorInfo,
            errorCount: prevState.errorCount + 1
        }));

        // Call optional onError callback
        if (this.props.onError) {
            this.props.onError(error, errorInfo);
        }
    }

    handleReset = () => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null
        });

        // Call optional onReset callback
        if (this.props.onReset) {
            this.props.onReset();
        }
    };

    handleReload = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            // Use custom fallback if provided
            if (this.props.fallback) {
                return this.props.fallback({
                    error: this.state.error,
                    errorInfo: this.state.errorInfo,
                    resetError: this.handleReset
                });
            }

            // Default error UI
            return (
                <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
                    <div className="max-w-lg w-full">
                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl overflow-hidden">
                            {/* Header */}
                            <div className="bg-gradient-to-r from-red-500 to-red-600 p-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                                        <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h1 className="text-2xl font-bold text-white">Terjadi Kesalahan</h1>
                                        <p className="text-red-100 text-sm mt-1">Aplikasi mengalami error yang tidak terduga</p>
                                    </div>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="p-6 space-y-4">
                                {/* Error Message */}
                                <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
                                    <p className="text-sm font-semibold text-red-800 dark:text-red-400 mb-2">
                                        Error Message:
                                    </p>
                                    <p className="text-sm text-red-600 dark:text-red-300 font-mono">
                                        {this.state.error?.toString() || 'Unknown error'}
                                    </p>
                                </div>

                                {/* Error Details (Development only) */}
                                {import.meta.env.DEV && this.state.errorInfo && (
                                    <details className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                                        <summary className="text-sm font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-white">
                                            Stack Trace (Development)
                                        </summary>
                                        <pre className="mt-3 text-xs text-gray-600 dark:text-gray-400 overflow-x-auto whitespace-pre-wrap font-mono">
                                            {this.state.errorInfo.componentStack}
                                        </pre>
                                    </details>
                                )}

                                {/* Help Text */}
                                <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl p-4">
                                    <div className="flex gap-3">
                                        <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <div>
                                            <p className="text-sm font-semibold text-blue-800 dark:text-blue-400 mb-1">
                                                Apa yang bisa dilakukan?
                                            </p>
                                            <ul className="text-sm text-blue-600 dark:text-blue-300 space-y-1">
                                                <li>• Coba refresh halaman</li>
                                                <li>• Periksa koneksi internet Anda</li>
                                                <li>• Hapus cache browser</li>
                                                <li>• Hubungi administrator jika masalah berlanjut</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                {/* Error Count Warning */}
                                {this.state.errorCount > 1 && (
                                    <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4">
                                        <p className="text-sm text-amber-800 dark:text-amber-400">
                                            ⚠️ Error terjadi {this.state.errorCount} kali. Pertimbangkan untuk reload halaman.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="p-6 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 flex gap-3">
                                <button
                                    onClick={this.handleReset}
                                    className="flex-1 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                                >
                                    Coba Lagi
                                </button>
                                <button
                                    onClick={this.handleReload}
                                    className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors"
                                >
                                    Reload Halaman
                                </button>
                            </div>
                        </div>

                        {/* Footer Note */}
                        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
                            Error ID: {Date.now().toString(36).toUpperCase()}
                        </p>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

/**
 * Lightweight Error Boundary for smaller sections
 * Shows inline error message instead of full-page error
 */
export class InlineErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        if (import.meta.env.DEV) {
            console.error('Inline error:', error, errorInfo);
        }
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <div className="w-8 h-8 bg-red-100 dark:bg-red-500/20 rounded-lg flex items-center justify-center text-red-500 flex-shrink-0">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold text-red-800 dark:text-red-400 mb-1">
                                {this.props.title || 'Terjadi Kesalahan'}
                            </h3>
                            <p className="text-sm text-red-600 dark:text-red-300 mb-3">
                                {this.state.error?.message || 'Komponen ini mengalami error'}
                            </p>
                            <button
                                onClick={this.handleReset}
                                className="text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline"
                            >
                                Coba Lagi
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
