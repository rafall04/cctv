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
                            : 'bg-surface-sunken text-content-muted hover:bg-surface-sunken'
                    }`}
                >
                    {status === '' ? 'Semua' : feedbackStatusConfig[status].label}
                </button>
            ))}
        </div>
    );
}
