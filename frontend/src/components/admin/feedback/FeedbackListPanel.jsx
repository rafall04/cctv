import { TableSkeleton } from '../../ui/Skeleton';
import { NoFeedbackEmptyState } from '../../ui/EmptyState';
import { FeedbackIcons, feedbackStatusConfig } from './feedbackConstants.jsx';

export default function FeedbackListPanel({
    loading,
    feedbacks,
    selectedFeedback,
    onSelect,
    pagination,
    onPreviousPage,
    onNextPage,
    formatDate,
}) {
    return (
        <div className="bg-surface rounded-xl border border-edge overflow-hidden">
            <div className="divide-y divide-edge max-h-[600px] overflow-y-auto">
                {loading ? (
                    <TableSkeleton rows={5} columns={4} />
                ) : feedbacks.length === 0 ? (
                    <NoFeedbackEmptyState />
                ) : (
                    feedbacks.map((feedback) => (
                        <div
                            key={feedback.id}
                            onClick={() => onSelect(feedback)}
                            className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                                selectedFeedback?.id === feedback.id ? 'bg-primary-100 dark:bg-sky-900/20' : ''
                            }`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        {feedback.status === 'unread' && (
                                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                                        )}
                                        <span className="font-medium text-content truncate">
                                            {feedback.name || 'Anonim'}
                                        </span>
                                    </div>
                                    <p className="text-sm text-content-muted line-clamp-2">
                                        {feedback.message}
                                    </p>
                                    <div className="flex items-center gap-3 mt-2 text-xs text-content-subtle">
                                        <span className="flex items-center gap-1">
                                            <FeedbackIcons.Clock />
                                            {formatDate(feedback.created_at)}
                                        </span>
                                    </div>
                                </div>
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${feedbackStatusConfig[feedback.status].color}`}>
                                    {feedbackStatusConfig[feedback.status].label}
                                </span>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-edge">
                    <button
                        onClick={onPreviousPage}
                        disabled={pagination.page === 1}
                        className="p-2 rounded-lg hover:bg-surface-sunken disabled:opacity-50"
                    >
                        <FeedbackIcons.ChevronLeft />
                    </button>
                    <span className="text-sm text-content-muted">
                        {pagination.page} / {pagination.totalPages}
                    </span>
                    <button
                        onClick={onNextPage}
                        disabled={pagination.page === pagination.totalPages}
                        className="p-2 rounded-lg hover:bg-surface-sunken disabled:opacity-50"
                    >
                        <FeedbackIcons.ChevronRight />
                    </button>
                </div>
            )}
        </div>
    );
}
