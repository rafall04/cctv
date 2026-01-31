import React from 'react';

/**
 * EmptyState Component - Improved empty states with illustrations
 * Provides better UX when there's no data to display
 */

// SVG Illustrations
const Illustrations = {
    // No cameras illustration
    NoCamera: () => (
        <svg className="w-full h-full" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" fill="currentColor" className="text-gray-100 dark:text-gray-800" />
            <path d="M70 85h60v40H70z" fill="currentColor" className="text-gray-200 dark:text-gray-700" />
            <circle cx="100" cy="105" r="15" fill="currentColor" className="text-gray-300 dark:text-gray-600" />
            <path d="M130 85l15-10v40l-15-10" fill="currentColor" className="text-gray-300 dark:text-gray-600" />
            <line x1="60" y1="60" x2="140" y2="140" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="text-red-400" />
            <line x1="140" y1="60" x2="60" y2="140" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="text-red-400" />
        </svg>
    ),
    
    // No data/search results illustration
    NoData: () => (
        <svg className="w-full h-full" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" fill="currentColor" className="text-gray-100 dark:text-gray-800" />
            <circle cx="85" cy="85" r="30" stroke="currentColor" strokeWidth="4" className="text-gray-300 dark:text-gray-600" />
            <line x1="107" y1="107" x2="130" y2="130" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="text-gray-300 dark:text-gray-600" />
            <path d="M75 85h20M85 75v20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-gray-400 dark:text-gray-500" />
        </svg>
    ),
    
    // No feedback illustration
    NoFeedback: () => (
        <svg className="w-full h-full" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" fill="currentColor" className="text-gray-100 dark:text-gray-800" />
            <rect x="60" y="70" width="80" height="60" rx="8" fill="currentColor" className="text-gray-200 dark:text-gray-700" />
            <path d="M100 130l-10 15h20z" fill="currentColor" className="text-gray-200 dark:text-gray-700" />
            <line x1="70" y1="85" x2="130" y2="85" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-gray-300 dark:text-gray-600" />
            <line x1="70" y1="100" x2="120" y2="100" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-gray-300 dark:text-gray-600" />
            <line x1="70" y1="115" x2="110" y2="115" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-gray-300 dark:text-gray-600" />
        </svg>
    ),
    
    // No users illustration
    NoUsers: () => (
        <svg className="w-full h-full" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" fill="currentColor" className="text-gray-100 dark:text-gray-800" />
            <circle cx="100" cy="85" r="20" fill="currentColor" className="text-gray-300 dark:text-gray-600" />
            <path d="M70 130c0-16.569 13.431-30 30-30s30 13.431 30 30" fill="currentColor" className="text-gray-300 dark:text-gray-600" />
            <circle cx="70" cy="95" r="12" fill="currentColor" className="text-gray-200 dark:text-gray-700" />
            <circle cx="130" cy="95" r="12" fill="currentColor" className="text-gray-200 dark:text-gray-700" />
        </svg>
    ),
    
    // No areas illustration
    NoAreas: () => (
        <svg className="w-full h-full" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" fill="currentColor" className="text-gray-100 dark:text-gray-800" />
            <path d="M100 60l-30 30v40h60v-40z" fill="currentColor" className="text-gray-200 dark:text-gray-700" />
            <rect x="85" y="110" width="12" height="20" fill="currentColor" className="text-gray-300 dark:text-gray-600" />
            <rect x="75" y="85" width="15" height="15" fill="currentColor" className="text-gray-300 dark:text-gray-600" />
            <rect x="110" y="85" width="15" height="15" fill="currentColor" className="text-gray-300 dark:text-gray-600" />
        </svg>
    ),
    
    // No activity/logs illustration
    NoActivity: () => (
        <svg className="w-full h-full" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" fill="currentColor" className="text-gray-100 dark:text-gray-800" />
            <circle cx="100" cy="100" r="50" stroke="currentColor" strokeWidth="4" className="text-gray-300 dark:text-gray-600" />
            <line x1="100" y1="100" x2="100" y2="70" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="text-gray-400 dark:text-gray-500" />
            <line x1="100" y1="100" x2="120" y2="100" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="text-gray-400 dark:text-gray-500" />
        </svg>
    ),
    
    // Error illustration
    Error: () => (
        <svg className="w-full h-full" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" fill="currentColor" className="text-red-50 dark:text-red-900/20" />
            <circle cx="100" cy="100" r="50" stroke="currentColor" strokeWidth="4" className="text-red-300 dark:text-red-700" />
            <line x1="85" y1="85" x2="115" y2="115" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="text-red-500" />
            <line x1="115" y1="85" x2="85" y2="115" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="text-red-500" />
        </svg>
    ),
    
    // Success/completed illustration
    Success: () => (
        <svg className="w-full h-full" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" fill="currentColor" className="text-emerald-50 dark:text-emerald-900/20" />
            <circle cx="100" cy="100" r="50" stroke="currentColor" strokeWidth="4" className="text-emerald-300 dark:text-emerald-700" />
            <path d="M75 100l15 15 35-35" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500" />
        </svg>
    ),
};

/**
 * Base EmptyState Component
 */
export function EmptyState({
    illustration = 'NoData',
    title,
    description,
    action,
    actionLabel,
    secondaryAction,
    secondaryActionLabel,
    className = '',
}) {
    const IllustrationComponent = Illustrations[illustration] || Illustrations.NoData;
    
    return (
        <div className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}>
            {/* Illustration */}
            <div className="w-32 h-32 mb-6">
                <IllustrationComponent />
            </div>
            
            {/* Title */}
            {title && (
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    {title}
                </h3>
            )}
            
            {/* Description */}
            {description && (
                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mb-6">
                    {description}
                </p>
            )}
            
            {/* Actions */}
            {(action || secondaryAction) && (
                <div className="flex flex-col sm:flex-row gap-3">
                    {action && (
                        <button
                            onClick={action}
                            className="px-6 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-medium rounded-lg transition-colors shadow-sm"
                        >
                            {actionLabel || 'Take Action'}
                        </button>
                    )}
                    {secondaryAction && (
                        <button
                            onClick={secondaryAction}
                            className="px-6 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors"
                        >
                            {secondaryActionLabel || 'Secondary Action'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Preset Empty States for common scenarios
 */

// No cameras found
export function NoCamerasEmptyState({ onAddCamera }) {
    return (
        <EmptyState
            illustration="NoCamera"
            title="Belum Ada Kamera"
            description="Mulai dengan menambahkan kamera CCTV pertama Anda. Kamera akan muncul di sini setelah ditambahkan."
            action={onAddCamera}
            actionLabel="Tambah Kamera"
        />
    );
}

// No search results
export function NoSearchResultsEmptyState({ searchQuery, onClearSearch }) {
    return (
        <EmptyState
            illustration="NoData"
            title="Tidak Ditemukan"
            description={`Tidak ada hasil untuk "${searchQuery}". Coba kata kunci lain atau hapus filter pencarian.`}
            action={onClearSearch}
            actionLabel="Hapus Pencarian"
        />
    );
}

// No feedback
export function NoFeedbackEmptyState() {
    return (
        <EmptyState
            illustration="NoFeedback"
            title="Belum Ada Feedback"
            description="Feedback dari pengguna akan muncul di sini. Tunggu hingga ada pengguna yang mengirimkan kritik atau saran."
        />
    );
}

// No users
export function NoUsersEmptyState({ onAddUser }) {
    return (
        <EmptyState
            illustration="NoUsers"
            title="Belum Ada User"
            description="Tambahkan user admin untuk mengelola sistem CCTV. Setiap user dapat memiliki role dan permission berbeda."
            action={onAddUser}
            actionLabel="Tambah User"
        />
    );
}

// No areas
export function NoAreasEmptyState({ onAddArea }) {
    return (
        <EmptyState
            illustration="NoAreas"
            title="Belum Ada Area"
            description="Buat area untuk mengelompokkan kamera berdasarkan lokasi. Area membantu organisasi kamera yang lebih baik."
            action={onAddArea}
            actionLabel="Tambah Area"
        />
    );
}

// No activity/logs
export function NoActivityEmptyState() {
    return (
        <EmptyState
            illustration="NoActivity"
            title="Belum Ada Aktivitas"
            description="Aktivitas admin dan log sistem akan muncul di sini. Semua perubahan akan tercatat secara otomatis."
        />
    );
}

// No streams/viewers
export function NoStreamsEmptyState() {
    return (
        <EmptyState
            illustration="NoCamera"
            title="Tidak Ada Stream Aktif"
            description="Belum ada viewer yang menonton kamera saat ini. Data viewer akan muncul ketika ada yang mengakses stream."
        />
    );
}

// Error state
export function ErrorEmptyState({ error, onRetry }) {
    return (
        <EmptyState
            illustration="Error"
            title="Terjadi Kesalahan"
            description={error || "Gagal memuat data. Silakan coba lagi atau hubungi administrator jika masalah berlanjut."}
            action={onRetry}
            actionLabel="Coba Lagi"
        />
    );
}

// Success/completed state
export function SuccessEmptyState({ title, description, onContinue, continueLabel }) {
    return (
        <EmptyState
            illustration="Success"
            title={title || "Berhasil!"}
            description={description || "Operasi berhasil diselesaikan."}
            action={onContinue}
            actionLabel={continueLabel || "Lanjutkan"}
        />
    );
}

// No data with filter
export function NoDataWithFilterEmptyState({ filterName, onClearFilter }) {
    return (
        <EmptyState
            illustration="NoData"
            title="Tidak Ada Data"
            description={`Tidak ada data yang sesuai dengan filter "${filterName}". Coba ubah atau hapus filter untuk melihat lebih banyak data.`}
            action={onClearFilter}
            actionLabel="Hapus Filter"
        />
    );
}

// Maintenance mode
export function MaintenanceEmptyState() {
    return (
        <EmptyState
            illustration="NoCamera"
            title="Sedang Maintenance"
            description="Fitur ini sedang dalam perbaikan. Silakan coba lagi nanti atau hubungi administrator untuk informasi lebih lanjut."
        />
    );
}

// Coming soon
export function ComingSoonEmptyState({ featureName }) {
    return (
        <EmptyState
            illustration="NoData"
            title="Segera Hadir"
            description={`Fitur ${featureName || 'ini'} sedang dalam pengembangan dan akan segera tersedia. Nantikan update selanjutnya!`}
        />
    );
}

export default EmptyState;
