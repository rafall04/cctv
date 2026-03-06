export default function CameraBasicFields({
    formData,
    areas,
    isSubmitting,
    onChange,
    onBlur,
    getFieldError,
}) {
    return (
        <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                    <label htmlFor="camera-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Name <span className="text-red-500">*</span>
                    </label>
                    <input
                        id="camera-name"
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={onChange}
                        onBlur={onBlur}
                        disabled={isSubmitting}
                        className={`w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 text-sm ${getFieldError('name') ? 'border-red-500 focus:ring-red-500' : 'border-gray-200 dark:border-gray-700/50'}`}
                        placeholder="Front Entrance"
                    />
                    {getFieldError('name') && (
                        <p className="mt-1 text-xs text-red-500">{getFieldError('name')}</p>
                    )}
                </div>

                <div>
                    <label htmlFor="camera-area" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Area</label>
                    <select
                        id="camera-area"
                        name="area_id"
                        value={formData.area_id}
                        onChange={onChange}
                        disabled={isSubmitting}
                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 text-sm"
                    >
                        <option value="">Select Area</option>
                        {areas.map((area) => (
                            <option key={area.id} value={area.id}>{area.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                    <label htmlFor="camera-location" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location</label>
                    <input
                        id="camera-location"
                        type="text"
                        name="location"
                        value={formData.location}
                        onChange={onChange}
                        disabled={isSubmitting}
                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 text-sm"
                        placeholder="Building A"
                    />
                </div>

                <div>
                    <label htmlFor="camera-group" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Group</label>
                    <input
                        id="camera-group"
                        type="text"
                        name="group_name"
                        value={formData.group_name}
                        onChange={onChange}
                        disabled={isSubmitting}
                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 text-sm"
                        placeholder="Security"
                    />
                </div>
            </div>

            <div>
                <label htmlFor="camera-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea
                    id="camera-description"
                    name="description"
                    value={formData.description}
                    onChange={onChange}
                    disabled={isSubmitting}
                    rows="2"
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary resize-none disabled:opacity-50 text-sm"
                    placeholder="Optional notes..."
                />
            </div>
        </>
    );
}
