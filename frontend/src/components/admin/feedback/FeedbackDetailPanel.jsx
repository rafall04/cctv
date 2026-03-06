import { FeedbackIcons, feedbackStatusConfig } from './feedbackConstants.jsx';

export default function FeedbackDetailPanel({
    selectedFeedback,
    formatDate,
    onMarkRead,
    onMarkResolved,
    onDelete,
}) {
    return (
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
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${feedbackStatusConfig[selectedFeedback.status].color}`}>
                            {feedbackStatusConfig[selectedFeedback.status].label}
                        </span>
                    </div>

                    <div className="text-sm text-gray-400 flex items-center gap-4">
                        <span className="flex items-center gap-1">
                            <FeedbackIcons.Clock />
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
                            onClick={onMarkRead}
                            disabled={selectedFeedback.status === 'read'}
                            className="inline-flex items-center gap-2 px-3 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 disabled:opacity-50"
                        >
                            <FeedbackIcons.MailOpen />
                            Tandai Dibaca
                        </button>
                        <button
                            onClick={onMarkResolved}
                            disabled={selectedFeedback.status === 'resolved'}
                            className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-200 dark:hover:bg-emerald-900/50 disabled:opacity-50"
                        >
                            <FeedbackIcons.Check />
                            Selesai
                        </button>
                        <button
                            onClick={onDelete}
                            className="inline-flex items-center gap-2 px-3 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium hover:bg-red-200 dark:hover:bg-red-900/50"
                        >
                            <FeedbackIcons.Trash />
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
    );
}
