import { useState, useEffect } from 'react';
import { feedbackService } from '../services/feedbackService';
import { TableSkeleton } from '../components/ui/Skeleton';
import { NoFeedbackEmptyState } from '../components/ui/EmptyState';

const Icons = {
    Mail: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>,
    MailOpen: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M3 19V9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>,
    Check: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>,
    Trash: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>,
    User: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>,
    Clock: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
    ChevronLeft: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>,
    ChevronRight: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 5l7 7-7 7"/></svg>,
    Refresh: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>,
};

const statusConfig = {
    unread: { label: 'Belum Dibaca', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
    read: { label: 'Sudah Dibaca', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    resolved: { label: 'Selesai', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
};

export default function FeedbackManagement() {
    const [feedbacks, setFeedbacks] = useState([]);
    const [stats, setStats] = useState({ total: 0, unread: 0, read: 0, resolved: 0 });
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [filter, setFilter] = useState('');
    const [selectedFeedback, setSelectedFeedback] = useState(null);

    const fetchFeedbacks = async () => {
        setLoading(true);
        try {
            const params = { page: pagination.page, limit: pagination.limit };
            if (filter) params.status = filter;

            const response = await feedbackService.getAll(params);
            setFeedbacks(response.data);
            setPagination(prev => ({ ...prev, ...response.pagination }));
        } catch (error) {
            console.error('Failed to fetch feedbacks:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchStats = async () => {
        try {
            const response = await feedbackService.getStats();
            setStats(response.data);
        } catch (error) {
            console.error('Failed to fetch stats:', error);
        }
    };

    useEffect(() => {
        fetchFeedbacks();
        fetchStats();
    }, [pagination.page, filter]);

    const handleStatusChange = async (id, newStatus) => {
        try {
            await feedbackService.updateStatus(id, newStatus);
            fetchFeedbacks();
            fetchStats();
            if (selectedFeedback?.id === id) {
                setSelectedFeedback(prev => ({ ...prev, status: newStatus }));
            }
        } catch (error) {
            console.error('Failed to update status:', error);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('Yakin ingin menghapus feedback ini?')) return;
        try {
            await feedbackService.delete(id);
            fetchFeedbacks();
            fetchStats();
            if (selectedFeedback?.id === id) {
                setSelectedFeedback(null);
            }
        } catch (error) {
            console.error('Failed to delete feedback:', error);
        }
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Kritik & Saran</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">Kelola feedback dari pengunjung</p>
                </div>
                <button
                    onClick={() => { fetchFeedbacks(); fetchStats(); }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                    <Icons.Refresh />
                    Refresh
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">Total</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                    <div className="text-2xl font-bold text-amber-500">{stats.unread}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">Belum Dibaca</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                    <div className="text-2xl font-bold text-blue-500">{stats.read}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">Sudah Dibaca</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                    <div className="text-2xl font-bold text-emerald-500">{stats.resolved}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">Selesai</div>
                </div>
            </div>

            {/* Filter */}
            <div className="flex gap-2 flex-wrap">
                {['', 'unread', 'read', 'resolved'].map((status) => (
                    <button
                        key={status}
                        onClick={() => { setFilter(status); setPagination(prev => ({ ...prev, page: 1 })); }}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            filter === status
                                ? 'bg-sky-500 text-white'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                    >
                        {status === '' ? 'Semua' : statusConfig[status].label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* List */}
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-[600px] overflow-y-auto">
                        {loading ? (
                            <TableSkeleton rows={5} columns={4} />
                        ) : feedbacks.length === 0 ? (
                            <NoFeedbackEmptyState />
                        ) : (
                            feedbacks.map((feedback) => (
                                <div
                                    key={feedback.id}
                                    onClick={() => {
                                        setSelectedFeedback(feedback);
                                        if (feedback.status === 'unread') {
                                            handleStatusChange(feedback.id, 'read');
                                        }
                                    }}
                                    className={`p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                                        selectedFeedback?.id === feedback.id ? 'bg-sky-50 dark:bg-sky-900/20' : ''
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                {feedback.status === 'unread' && (
                                                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                                                )}
                                                <span className="font-medium text-gray-900 dark:text-white truncate">
                                                    {feedback.name || 'Anonim'}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                                                {feedback.message}
                                            </p>
                                            <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                                                <span className="flex items-center gap-1">
                                                    <Icons.Clock />
                                                    {formatDate(feedback.created_at)}
                                                </span>
                                            </div>
                                        </div>
                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusConfig[feedback.status].color}`}>
                                            {statusConfig[feedback.status].label}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Pagination */}
                    {pagination.totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                            <button
                                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                                disabled={pagination.page === 1}
                                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                            >
                                <Icons.ChevronLeft />
                            </button>
                            <span className="text-sm text-gray-500">
                                {pagination.page} / {pagination.totalPages}
                            </span>
                            <button
                                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                                disabled={pagination.page === pagination.totalPages}
                                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                            >
                                <Icons.ChevronRight />
                            </button>
                        </div>
                    )}
                </div>

                {/* Detail */}
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                    {selectedFeedback ? (
                        <div className="space-y-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                        {selectedFeedback.name || 'Anonim'}
                                    </h3>
                                    {selectedFeedback.email && (
                                        <p className="text-sm text-gray-500">{selectedFeedback.email}</p>
                                    )}
                                </div>
                                <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusConfig[selectedFeedback.status].color}`}>
                                    {statusConfig[selectedFeedback.status].label}
                                </span>
                            </div>

                            <div className="text-sm text-gray-400 flex items-center gap-4">
                                <span className="flex items-center gap-1">
                                    <Icons.Clock />
                                    {formatDate(selectedFeedback.created_at)}
                                </span>
                                <span>ID: #{selectedFeedback.id}</span>
                            </div>

                            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                    {selectedFeedback.message}
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                                <button
                                    onClick={() => handleStatusChange(selectedFeedback.id, 'read')}
                                    disabled={selectedFeedback.status === 'read'}
                                    className="inline-flex items-center gap-2 px-3 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 disabled:opacity-50"
                                >
                                    <Icons.MailOpen />
                                    Tandai Dibaca
                                </button>
                                <button
                                    onClick={() => handleStatusChange(selectedFeedback.id, 'resolved')}
                                    disabled={selectedFeedback.status === 'resolved'}
                                    className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-200 dark:hover:bg-emerald-900/50 disabled:opacity-50"
                                >
                                    <Icons.Check />
                                    Selesai
                                </button>
                                <button
                                    onClick={() => handleDelete(selectedFeedback.id)}
                                    className="inline-flex items-center gap-2 px-3 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium hover:bg-red-200 dark:hover:bg-red-900/50"
                                >
                                    <Icons.Trash />
                                    Hapus
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-gray-400">
                            <p>Pilih feedback untuk melihat detail</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
