import { feedbackStatusConfig } from './feedbackConstants.jsx';

export default function FeedbackFilterBar({ filter, onChange }) {
    return (
        <div className="flex gap-2 flex-wrap">
            {['', 'unread', 'read', 'resolved'].map((status) => (
                <button
                    key={status}
                    onClick={() => onChange(status)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        filter === status
                            ? 'bg-primary text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                >
                    {status === '' ? 'Semua' : feedbackStatusConfig[status].label}
                </button>
            ))}
        </div>
    );
}
