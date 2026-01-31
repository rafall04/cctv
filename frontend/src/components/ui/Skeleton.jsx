import React from 'react';

/**
 * Skeleton Component - Loading placeholder
 * Digunakan untuk menampilkan loading state yang lebih baik dari spinner
 */

export function Skeleton({ className = '', variant = 'default', ...props }) {
    const baseClasses = 'animate-pulse bg-gray-700/50 rounded';
    
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
