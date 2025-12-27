/**
 * EmptyState Component
 * 
 * Informative placeholder displayed when no data exists.
 * Supports icon, title, description, and action buttons.
 * 
 * Requirements: 9.1, 9.2, 9.4, 9.5, 9.6
 */

// Default icons for common empty states
const CameraIcon = () => (
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const FolderIcon = () => (
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
);

const UsersIcon = () => (
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
);

const SearchIcon = () => (
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
);

const ActivityIcon = () => (
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
);

const InboxIcon = () => (
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
    </svg>
);

// Export icons for external use
export const EMPTY_STATE_ICONS = {
    camera: CameraIcon,
    folder: FolderIcon,
    users: UsersIcon,
    search: SearchIcon,
    activity: ActivityIcon,
    inbox: InboxIcon,
};

/**
 * EmptyState component for displaying when no data exists
 * @param {Object} props
 * @param {React.ReactNode} [props.icon] - Icon component or element to display
 * @param {string} [props.iconType] - Predefined icon type (camera, folder, users, search, activity, inbox)
 * @param {string} props.title - Title text
 * @param {string} props.description - Description text
 * @param {Object} [props.action] - Primary action button
 * @param {string} props.action.label - Button label
 * @param {Function} props.action.onClick - Button click handler
 * @param {Object} [props.secondaryAction] - Secondary action button
 * @param {string} props.secondaryAction.label - Button label
 * @param {Function} props.secondaryAction.onClick - Button click handler
 * @param {string} [props.className] - Additional CSS classes
 */
export function EmptyState({
    icon,
    iconType,
    title,
    description,
    action,
    secondaryAction,
    className = '',
}) {
    // Determine which icon to render
    const IconComponent = icon || (iconType && EMPTY_STATE_ICONS[iconType]) || InboxIcon;
    const renderIcon = typeof IconComponent === 'function' ? <IconComponent /> : IconComponent;

    return (
        <div className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}>
            {/* Icon */}
            <div className="text-dark-400 mb-4">
                {renderIcon}
            </div>

            {/* Title */}
            <h3 className="text-lg font-medium text-dark-200 mb-2">
                {title}
            </h3>

            {/* Description */}
            <p className="text-sm text-dark-400 max-w-sm mb-6">
                {description}
            </p>

            {/* Actions */}
            {(action || secondaryAction) && (
                <div className="flex flex-wrap gap-3 justify-center">
                    {action && (
                        <button
                            onClick={action.onClick}
                            className="inline-flex items-center px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-900"
                        >
                            {action.label}
                        </button>
                    )}
                    {secondaryAction && (
                        <button
                            onClick={secondaryAction.onClick}
                            className="inline-flex items-center px-4 py-2 bg-dark-700 hover:bg-dark-600 text-dark-200 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-dark-500 focus:ring-offset-2 focus:ring-offset-dark-900"
                        >
                            {secondaryAction.label}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Preset empty states for common scenarios
 */

export function NoCamerasEmptyState({ onAddCamera }) {
    return (
        <EmptyState
            iconType="camera"
            title="No cameras configured"
            description="Get started by adding your first camera to monitor your space."
            action={{
                label: 'Add Camera',
                onClick: onAddCamera,
            }}
        />
    );
}

export function NoAreasEmptyState({ onCreateArea }) {
    return (
        <EmptyState
            iconType="folder"
            title="No areas created"
            description="Areas help you organize cameras by location or purpose. Create your first area to get started."
            action={{
                label: 'Create Area',
                onClick: onCreateArea,
            }}
        />
    );
}

export function NoUsersEmptyState() {
    return (
        <EmptyState
            iconType="users"
            title="No users found"
            description="There are no user accounts in the system. This shouldn't normally happen."
        />
    );
}

export function NoActivityEmptyState() {
    return (
        <EmptyState
            iconType="activity"
            title="No recent activity"
            description="Activity logs will appear here once actions are performed in the system."
        />
    );
}

export function NoSearchResultsEmptyState({ onClearFilters }) {
    return (
        <EmptyState
            iconType="search"
            title="No results found"
            description="Try adjusting your search terms or clearing filters to see more results."
            action={onClearFilters ? {
                label: 'Clear Filters',
                onClick: onClearFilters,
            } : undefined}
        />
    );
}

export function NoStreamsEmptyState({ onAddCamera }) {
    return (
        <EmptyState
            iconType="camera"
            title="No active streams"
            description="There are no cameras currently streaming. Add a camera or enable an existing one to start viewing."
            action={onAddCamera ? {
                label: 'Add Camera',
                onClick: onAddCamera,
            } : undefined}
        />
    );
}

export default EmptyState;
