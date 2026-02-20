import React, { memo } from 'react';
import { shouldDisableAnimations } from '../../utils/animationControl';

/**
 * Skeleton Component - Loading placeholder
 * Digunakan untuk menampilkan loading state yang lebih baik dari spinner
 */

export function Skeleton({ className = '', variant = 'default', ...props }) {
    const disableAnimations = shouldDisableAnimations();
    const pulseClass = disableAnimations ? 'opacity-75' : 'animate-pulse';
    const baseClasses = `${pulseClass} bg-gray-700/50 rounded`;

    const variants = {
        default: '',
        text: 'h-4 w-full',
        title: 'h-6 w-3/4',
        avatar: 'h-12 w-12 rounded-full',
        button: 'h-10 w-24',
        card: 'h-48 w-full',
        thumbnail: 'aspect-video w-full',
    };

    return (
        <div
            className={`${baseClasses} ${variants[variant]} ${className}`}
            {...props}
        />
    );
}

/**
 * CameraCardSkeleton - Skeleton untuk camera card di grid
 */
export function CameraCardSkeleton() {
    return (
        <div className="bg-dark-800/50 backdrop-blur-sm border border-dark-700/50 rounded-xl overflow-hidden">
            {/* Video thumbnail skeleton */}
            <Skeleton variant="thumbnail" className="rounded-none" />

            {/* Content skeleton */}
            <div className="p-4 space-y-3">
                {/* Title */}
                <Skeleton variant="title" />

                {/* Location */}
                <div className="space-y-2">
                    <Skeleton variant="text" className="w-2/3" />
                    <Skeleton variant="text" className="w-1/2" />
                </div>

                {/* Badges */}
                <div className="flex gap-2">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-6 w-16" />
                </div>

                {/* Button */}
                <Skeleton variant="button" className="w-full" />
            </div>
        </div>
    );
}

/**
 * TableRowSkeleton - Skeleton untuk table row
 */
export function TableRowSkeleton({ columns = 5 }) {
    return (
        <tr className="border-b border-dark-700/50">
            {Array.from({ length: columns }).map((_, index) => (
                <td key={index} className="px-4 py-3">
                    <Skeleton variant="text" />
                </td>
            ))}
        </tr>
    );
}

/**
 * TableSkeleton - Skeleton untuk entire table
 */
export function TableSkeleton({ rows = 5, columns = 5 }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full">
                <thead className="bg-dark-800/50 border-b border-dark-700">
                    <tr>
                        {Array.from({ length: columns }).map((_, index) => (
                            <th key={index} className="px-4 py-3 text-left">
                                <Skeleton variant="text" className="w-24" />
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: rows }).map((_, index) => (
                        <TableRowSkeleton key={index} columns={columns} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/**
 * StatCardSkeleton - Skeleton untuk statistics card
 */
export function StatCardSkeleton() {
    return (
        <div className="bg-dark-800/50 backdrop-blur-sm border border-dark-700/50 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton variant="title" className="mb-2" />
            <Skeleton variant="text" className="w-1/2" />
        </div>
    );
}

/**
 * ListItemSkeleton - Skeleton untuk list item
 */
export function ListItemSkeleton() {
    return (
        <div className="flex items-center gap-4 p-4 border-b border-dark-700/50">
            <Skeleton variant="avatar" />
            <div className="flex-1 space-y-2">
                <Skeleton variant="title" />
                <Skeleton variant="text" className="w-3/4" />
            </div>
            <Skeleton className="h-8 w-20" />
        </div>
    );
}

/**
 * FormSkeleton - Skeleton untuk form
 */
export function FormSkeleton({ fields = 4 }) {
    return (
        <div className="space-y-4">
            {Array.from({ length: fields }).map((_, index) => (
                <div key={index} className="space-y-2">
                    <Skeleton variant="text" className="w-32" />
                    <Skeleton className="h-10 w-full" />
                </div>
            ))}
            <div className="flex gap-3 pt-4">
                <Skeleton variant="button" className="flex-1" />
                <Skeleton variant="button" className="flex-1" />
            </div>
        </div>
    );
}

/**
 * GridSkeleton - Skeleton untuk grid layout
 */
export function GridSkeleton({
    items = 6,
    columns = 3,
    SkeletonComponent = CameraCardSkeleton
}) {
    const gridCols = {
        1: 'grid-cols-1',
        2: 'grid-cols-1 md:grid-cols-2',
        3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
        4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
    };

    return (
        <div className={`grid ${gridCols[columns]} gap-6`}>
            {Array.from({ length: items }).map((_, index) => (
                <SkeletonComponent key={index} />
            ))}
        </div>
    );
}

/**
 * DashboardSkeleton - Skeleton untuk dashboard page
 */
export function DashboardSkeleton() {
    return (
        <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {Array.from({ length: 4 }).map((_, index) => (
                    <StatCardSkeleton key={index} />
                ))}
            </div>

            {/* Content Area */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-dark-800/50 backdrop-blur-sm border border-dark-700/50 rounded-xl p-6">
                    <Skeleton variant="title" className="mb-4" />
                    <div className="space-y-3">
                        {Array.from({ length: 5 }).map((_, index) => (
                            <ListItemSkeleton key={index} />
                        ))}
                    </div>
                </div>

                <div className="bg-dark-800/50 backdrop-blur-sm border border-dark-700/50 rounded-xl p-6">
                    <Skeleton variant="title" className="mb-4" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>
        </div>
    );
}

/**
 * VideoSkeleton - Animated loading placeholder for video player
 * Disables animations on low-end devices
 */
export const VideoSkeleton = memo(function VideoSkeleton({ size = 'large' }) {
    const isSmall = size === 'small';
    const disableAnimations = shouldDisableAnimations();

    // Get animation classes based on device tier
    const pulseClass = disableAnimations ? 'opacity-75' : 'animate-pulse';
    const spinClass = disableAnimations ? '' : 'animate-spin';
    const shimmerClass = disableAnimations ? '' : 'animate-[shimmer_2s_infinite]';

    return (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 flex flex-col items-center justify-center pointer-events-none overflow-hidden">
            {/* Animated shimmer background - disabled on low-end */}
            {!disableAnimations && (
                <div className="absolute inset-0 overflow-hidden">
                    <div className={`absolute inset-0 -translate-x-full ${shimmerClass} bg-gradient-to-r from-transparent via-white/5 to-transparent`} />
                </div>
            )}

            {/* Video player skeleton UI */}
            <div className="relative z-10 flex flex-col items-center gap-3">
                {/* Play button skeleton */}
                <div className={`${isSmall ? 'w-10 h-10' : 'w-16 h-16'} rounded-full bg-white/10 flex items-center justify-center ${pulseClass}`}>
                    <div className={`${isSmall ? 'w-4 h-4' : 'w-6 h-6'} border-2 border-white/30 border-t-sky-500 rounded-full ${spinClass}`} />
                </div>

                {/* Loading text */}
                <div className="flex flex-col items-center gap-1.5">
                    <div className={`${isSmall ? 'h-2 w-16' : 'h-3 w-24'} bg-white/10 rounded-full ${pulseClass}`} />
                    <div className={`${isSmall ? 'h-1.5 w-12' : 'h-2 w-20'} bg-white/5 rounded-full ${pulseClass}`} />
                </div>
            </div>

            {/* Bottom progress bar skeleton */}
            <div className="absolute bottom-0 left-0 right-0 p-3">
                <div className="flex items-center gap-2">
                    <div className={`${isSmall ? 'w-4 h-4' : 'w-6 h-6'} rounded bg-white/10 ${pulseClass}`} />
                    <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className={`h-full w-1/3 bg-white/20 rounded-full ${pulseClass}`} />
                    </div>
                    <div className={`${isSmall ? 'w-8' : 'w-12'} h-3 bg-white/10 rounded ${pulseClass}`} />
                </div>
            </div>

            {/* Corner decorations */}
            <div className="absolute top-3 left-3 flex items-center gap-2">
                <div className={`${isSmall ? 'w-8 h-4' : 'w-12 h-5'} bg-white/10 rounded-full ${pulseClass}`} />
            </div>
            <div className="absolute top-3 right-3">
                <div className={`${isSmall ? 'w-4 h-4' : 'w-6 h-6'} bg-white/10 rounded ${pulseClass}`} />
            </div>
        </div>
    );
});
