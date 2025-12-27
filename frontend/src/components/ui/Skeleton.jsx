/**
 * Skeleton Components
 * 
 * Loading placeholder components with pulse animation.
 * Provides base Skeleton and compound components for common patterns.
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

/**
 * Base Skeleton component with pulse animation
 * @param {Object} props
 * @param {string} [props.className] - Additional CSS classes
 * @param {'text' | 'circular' | 'rectangular'} [props.variant='rectangular'] - Shape variant
 * @param {string | number} [props.width] - Width (CSS value or number for pixels)
 * @param {string | number} [props.height] - Height (CSS value or number for pixels)
 */
export function Skeleton({ 
    className = '', 
    variant = 'rectangular',
    width,
    height,
}) {
    const baseClasses = 'animate-pulse bg-dark-700/50';
    
    const variantClasses = {
        text: 'rounded',
        circular: 'rounded-full',
        rectangular: 'rounded-lg',
    };

    // Use Object.hasOwn to safely check for variant to avoid prototype pollution
    const variantClass = Object.hasOwn(variantClasses, variant) 
        ? variantClasses[variant] 
        : variantClasses.rectangular;

    const style = {};
    if (width) {
        style.width = typeof width === 'number' ? `${width}px` : width;
    }
    if (height) {
        style.height = typeof height === 'number' ? `${height}px` : height;
    }

    return (
        <div
            className={`${baseClasses} ${variantClass} ${className}`}
            style={style}
            aria-hidden="true"
        />
    );
}

/**
 * Skeleton card for loading card content
 * @param {Object} props
 * @param {number} [props.lines=3] - Number of text lines to show
 * @param {boolean} [props.showImage=true] - Whether to show image placeholder
 * @param {string} [props.className] - Additional CSS classes
 */
export function SkeletonCard({ lines = 3, showImage = true, className = '' }) {
    return (
        <div className={`bg-dark-800/50 border border-dark-700/50 rounded-xl p-4 ${className}`}>
            {showImage && (
                <Skeleton 
                    variant="rectangular" 
                    className="w-full h-40 mb-4" 
                />
            )}
            <Skeleton 
                variant="text" 
                className="h-5 w-3/4 mb-3" 
            />
            {Array.from({ length: lines }).map((_, index) => (
                <Skeleton 
                    key={index}
                    variant="text" 
                    className={`h-4 mb-2 ${index === lines - 1 ? 'w-1/2' : 'w-full'}`}
                />
            ))}
        </div>
    );
}

/**
 * Skeleton table for loading table data
 * @param {Object} props
 * @param {number} [props.rows=5] - Number of rows to show
 * @param {number} [props.columns=4] - Number of columns to show
 * @param {string} [props.className] - Additional CSS classes
 */
export function SkeletonTable({ rows = 5, columns = 4, className = '' }) {
    return (
        <div className={`bg-dark-800/50 border border-dark-700/50 rounded-xl overflow-hidden ${className}`}>
            {/* Header */}
            <div className="bg-dark-700/30 px-4 py-3 border-b border-dark-700/50">
                <div className="flex gap-4">
                    {Array.from({ length: columns }).map((_, index) => (
                        <Skeleton 
                            key={`header-${index}`}
                            variant="text" 
                            className="h-4 flex-1" 
                        />
                    ))}
                </div>
            </div>
            {/* Rows */}
            {Array.from({ length: rows }).map((_, rowIndex) => (
                <div 
                    key={`row-${rowIndex}`}
                    className="px-4 py-3 border-b border-dark-700/30 last:border-b-0"
                >
                    <div className="flex gap-4 items-center">
                        {Array.from({ length: columns }).map((_, colIndex) => (
                            <Skeleton 
                                key={`cell-${rowIndex}-${colIndex}`}
                                variant="text" 
                                className={`h-4 flex-1 ${colIndex === 0 ? 'w-1/4' : ''}`}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * Skeleton stats for loading statistics/metrics cards
 * @param {Object} props
 * @param {number} [props.count=4] - Number of stat cards to show
 * @param {string} [props.className] - Additional CSS classes
 */
export function SkeletonStats({ count = 4, className = '' }) {
    return (
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 ${className}`}>
            {Array.from({ length: count }).map((_, index) => (
                <div 
                    key={index}
                    className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4"
                >
                    <div className="flex items-center justify-between mb-2">
                        <Skeleton variant="text" className="h-4 w-24" />
                        <Skeleton variant="circular" className="h-8 w-8" />
                    </div>
                    <Skeleton variant="text" className="h-8 w-20 mb-1" />
                    <Skeleton variant="text" className="h-3 w-16" />
                </div>
            ))}
        </div>
    );
}

/**
 * Skeleton form for loading form content
 * @param {Object} props
 * @param {number} [props.fields=3] - Number of form fields to show
 * @param {string} [props.className] - Additional CSS classes
 */
export function SkeletonForm({ fields = 3, className = '' }) {
    return (
        <div className={`space-y-4 ${className}`}>
            {Array.from({ length: fields }).map((_, index) => (
                <div key={index}>
                    <Skeleton variant="text" className="h-4 w-24 mb-2" />
                    <Skeleton variant="rectangular" className="h-10 w-full" />
                </div>
            ))}
            <div className="flex gap-3 pt-2">
                <Skeleton variant="rectangular" className="h-10 w-24" />
                <Skeleton variant="rectangular" className="h-10 w-20" />
            </div>
        </div>
    );
}

/**
 * Skeleton button for loading button state
 * @param {Object} props
 * @param {string} [props.className] - Additional CSS classes
 * @param {'sm' | 'md' | 'lg'} [props.size='md'] - Button size
 */
export function SkeletonButton({ className = '', size = 'md' }) {
    const sizeClasses = {
        sm: 'h-8 w-16',
        md: 'h-10 w-24',
        lg: 'h-12 w-32',
    };

    return (
        <Skeleton 
            variant="rectangular" 
            className={`${sizeClasses[size]} ${className}`}
        />
    );
}

export default Skeleton;
