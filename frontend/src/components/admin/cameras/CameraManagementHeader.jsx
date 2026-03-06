export default function CameraManagementHeader({ onAddCamera }) {
    return (
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
                <p className="text-sm font-semibold text-primary mb-1">Hardware Management</p>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Cameras</h1>
                <p className="text-gray-500 dark:text-gray-400 mt-1">Configure and monitor your CCTV endpoints</p>
            </div>
            <button
                onClick={onAddCamera}
                className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary to-primary-600 hover:from-primary-600 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-primary/25 transition-all"
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Camera
            </button>
        </div>
    );
}
