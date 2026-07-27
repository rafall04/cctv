/*
Purpose: Loading skeletons for the admin dashboard route.
Caller: pages/Dashboard.jsx during initial dashboard data load.
Deps: ../../ui/Skeleton.
MainFuncs: DashboardInitialSkeleton.
SideEffects: None.

A skeleton's only job is to reserve the space the real content will take, so the padding, radius
and grid gaps here MUST track the live layout — otherwise the page jumps when data lands (CLS).
They were rebuilt alongside the 2026-07 dashboard pass for exactly that reason.
*/

import { Skeleton } from '../../ui/Skeleton';

function SkeletonCard({ className = '', children }) {
    return <div className={`rounded-card border border-edge bg-surface p-4 ${className}`}>{children}</div>;
}

function DashboardStatsSkeleton() {
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
                <SkeletonCard key={i}>
                    <div className="mb-2 flex items-center justify-between">
                        <Skeleton variant="text" className="h-3 w-16" />
                        <Skeleton variant="rectangular" className="h-4 w-4 rounded" />
                    </div>
                    <Skeleton variant="text" className="mb-3 h-7 w-16" />
                    <Skeleton variant="text" className="h-1.5 w-full rounded-full" />
                </SkeletonCard>
            ))}
        </div>
    );
}

function DashboardStreamsSkeleton() {
    return (
        <div className="overflow-hidden rounded-card border border-edge bg-surface">
            <div className="border-b border-edge bg-surface-sunken px-3 py-2.5">
                <Skeleton variant="text" className="h-3 w-24" />
            </div>
            <div className="divide-y divide-edge">
                {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                        <Skeleton variant="text" className="h-4 w-6" />
                        <div className="min-w-0 flex-1">
                            <Skeleton variant="text" className="mb-1 h-4 w-32" />
                            <Skeleton variant="text" className="h-3 w-16" />
                        </div>
                        <Skeleton variant="text" className="h-5 w-16 rounded-full" />
                        <Skeleton variant="text" className="h-4 w-16" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function DashboardActivitySkeleton() {
    return (
        <SkeletonCard>
            <Skeleton variant="text" className="mb-4 h-4 w-32" />
            <div className="space-y-5">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex gap-3">
                        <Skeleton variant="circular" className="mt-1 h-3.5 w-3.5" />
                        <div className="flex-1">
                            <Skeleton variant="text" className="mb-2 h-4 w-full" />
                            <Skeleton variant="text" className="h-3 w-32" />
                        </div>
                    </div>
                ))}
            </div>
        </SkeletonCard>
    );
}

function DashboardHeaderSkeleton() {
    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <Skeleton variant="text" className="mb-2 h-6 w-32" />
                <Skeleton variant="text" className="h-4 w-56" />
            </div>
            <Skeleton variant="rectangular" className="h-11 w-32 rounded-control" />
        </div>
    );
}

export function DashboardInitialSkeleton() {
    return (
        <div className="space-y-6">
            <DashboardHeaderSkeleton />
            <DashboardStatsSkeleton />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="space-y-3 xl:col-span-2">
                    <div className="flex items-end justify-between">
                        <Skeleton variant="text" className="h-5 w-28" />
                        <Skeleton variant="rectangular" className="h-9 w-36 rounded-control" />
                    </div>
                    <DashboardStreamsSkeleton />
                </div>
                <div className="space-y-4">
                    <DashboardActivitySkeleton />
                </div>
            </div>
        </div>
    );
}
