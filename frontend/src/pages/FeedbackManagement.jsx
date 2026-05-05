/*
 * Purpose: Admin feedback management page with filters, list, detail, and status actions.
 * Caller: Protected admin feedback route.
 * Deps: Feedback services/components, feedback data hook, TimezoneContext.
 * MainFuncs: FeedbackManagement.
 * SideEffects: Fetches feedback data and updates/deletes feedback rows through API calls.
 */

import { feedbackService } from '../services/feedbackService';
import { FeedbackIcons } from '../components/admin/feedback/feedbackConstants.jsx';
import { useFeedbackManagementData } from '../hooks/admin/useFeedbackManagementData';
import FeedbackStatsGrid from '../components/admin/feedback/FeedbackStatsGrid';
import FeedbackFilterBar from '../components/admin/feedback/FeedbackFilterBar';
import FeedbackListPanel from '../components/admin/feedback/FeedbackListPanel';
import FeedbackDetailPanel from '../components/admin/feedback/FeedbackDetailPanel';
import { TIMESTAMP_STORAGE, useTimezone } from '../contexts/TimezoneContext';

export default function FeedbackManagement() {
    const { formatDateTime } = useTimezone();
    const {
        feedbacks,
        stats,
        loading,
        pagination,
        setPagination,
        filter,
        setFilter,
        selectedFeedback,
        setSelectedFeedback,
        refreshAll,
    } = useFeedbackManagementData();

    const handleStatusChange = async (id, newStatus) => {
        try {
            await feedbackService.updateStatus(id, newStatus);
            refreshAll();
            if (selectedFeedback?.id === id) {
                setSelectedFeedback((previous) => ({ ...previous, status: newStatus }));
            }
        } catch (error) {
            console.error('Failed to update status:', error);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('Yakin ingin menghapus feedback ini?')) {
            return;
        }

        try {
            await feedbackService.delete(id);
            refreshAll();
            if (selectedFeedback?.id === id) {
                setSelectedFeedback(null);
            }
        } catch (error) {
            console.error('Failed to delete feedback:', error);
        }
    };

    const formatDate = (dateStr) => formatDateTime(dateStr, {
        storage: TIMESTAMP_STORAGE.UTC_SQL,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

    const handleFilterChange = (nextFilter) => {
        setFilter(nextFilter);
        setPagination((previous) => ({ ...previous, page: 1 }));
    };

    const handleSelectFeedback = (feedback) => {
        setSelectedFeedback(feedback);
        if (feedback.status === 'unread') {
            handleStatusChange(feedback.id, 'read');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Kritik & Saran</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">Kelola feedback dari pengunjung</p>
                </div>
                <button
                    onClick={refreshAll}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                    <FeedbackIcons.Refresh />
                    Refresh
                </button>
            </div>

            <FeedbackStatsGrid stats={stats} />
            <FeedbackFilterBar filter={filter} onChange={handleFilterChange} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <FeedbackListPanel
                    loading={loading}
                    feedbacks={feedbacks}
                    selectedFeedback={selectedFeedback}
                    onSelect={handleSelectFeedback}
                    pagination={pagination}
                    onPreviousPage={() => setPagination((previous) => ({ ...previous, page: previous.page - 1 }))}
                    onNextPage={() => setPagination((previous) => ({ ...previous, page: previous.page + 1 }))}
                    formatDate={formatDate}
                />

                <FeedbackDetailPanel
                    selectedFeedback={selectedFeedback}
                    formatDate={formatDate}
                    onMarkRead={() => handleStatusChange(selectedFeedback.id, 'read')}
                    onMarkResolved={() => handleStatusChange(selectedFeedback.id, 'resolved')}
                    onDelete={() => handleDelete(selectedFeedback.id)}
                />
            </div>
        </div>
    );
}
