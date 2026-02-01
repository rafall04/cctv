export default function ApiKeySettings() {
    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                API Key Management
            </h2>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>Note:</strong> API Key management is available in the main Settings page.
                    This section will be enhanced in future updates.
                </p>
            </div>
        </div>
    );
}
