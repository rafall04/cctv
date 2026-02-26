import { useState } from 'react';
import { feedbackService } from '../services/feedbackService';

const Icons = {
    Chat: () => (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
    ),
    X: () => (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M6 18L18 6M6 6l12 12" />
        </svg>
    ),
    Send: () => (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
    ),
    Check: () => (
        <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
    ),
};

export default function FeedbackWidget({ isOpen, onClose }) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [error, setError] = useState('');
    const [form, setForm] = useState({
        name: '',
        email: '',
        message: '',
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (form.message.trim().length < 10) {
            setError('Pesan minimal 10 karakter');
            return;
        }

        setIsSubmitting(true);

        try {
            await feedbackService.submit({
                name: form.name || undefined,
                email: form.email || undefined,
                message: form.message,
            });

            setIsSuccess(true);
            setForm({ name: '', email: '', message: '' });

            // Auto close after 3 seconds
            setTimeout(() => {
                setIsSuccess(false);
                onClose();
            }, 3000);
        } catch (err) {
            setError(err.response?.data?.message || 'Gagal mengirim feedback');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-white">
                        <Icons.Chat />
                        <span className="font-semibold">Kritik & Saran</span>
                    </div>
                    <button
                        onClick={() => {
                            onClose();
                            setTimeout(() => {
                                setIsSuccess(false);
                                setError('');
                            }, 300);
                        }}
                        className="p-1 hover:bg-white/20 rounded-lg transition-colors text-white"
                    >
                        <Icons.X />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4">
                    {isSuccess ? (
                        <div className="text-center py-8">
                            <div className="text-emerald-500 flex justify-center mb-3">
                                <Icons.Check />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                                Terima Kasih!
                            </h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Kritik dan saran Anda telah kami terima
                            </p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-3">
                            <div>
                                <input
                                    type="text"
                                    placeholder="Nama (opsional)"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                                    maxLength={100}
                                />
                            </div>
                            <div>
                                <input
                                    type="email"
                                    placeholder="Email (opsional)"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                                    maxLength={100}
                                />
                            </div>
                            <div>
                                <textarea
                                    placeholder="Tulis kritik atau saran Anda..."
                                    value={form.message}
                                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent resize-none"
                                    rows={4}
                                    maxLength={1000}
                                    required
                                />
                                <div className="text-xs text-gray-400 text-right mt-1">
                                    {form.message.length}/1000
                                </div>
                            </div>

                            {error && (
                                <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isSubmitting || form.message.trim().length < 10}
                                className="w-full py-2.5 px-4 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Mengirim...
                                    </>
                                ) : (
                                    <>
                                        <Icons.Send />
                                        Kirim
                                    </>
                                )}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
