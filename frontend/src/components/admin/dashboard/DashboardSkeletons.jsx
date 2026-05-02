/*
Purpose: Loading skeletons for the admin dashboard route.
Caller: pages/Dashboard.jsx during initial dashboard data load.
Deps: ../../ui/Skeleton.
MainFuncs: DashboardInitialSkeleton.
SideEffects: None.
*/

import { Skeleton } from '../../ui/Skeleton';

function DashboardStatsSkeleton() {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <Skeleton variant="rectangular" className="w-12 h-12 rounded-xl" />
                        <Skeleton variant="text" className="h-3 w-16" />
                    </div>
                    <Skeleton variant="text" className="h-9 w-16 mb-2" />
                    <Skeleton variant="text" className="h-4 w-24" />
                </div>
            ))}
        </div>
    );
}

function DashboardStreamsSkeleton() {
    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/50">
                            <th className="px-6 py-4 text-left"><Skeleton variant="text" className="h-3 w-16" /></th>
                            <th className="px-6 py-4 text-left"><Skeleton variant="text" className="h-3 w-12" /></th>
                            <th className="px-6 py-4 text-center"><Skeleton variant="text" className="h-3 w-14 mx-auto" /></th>
                            <th className="px-6 py-4 text-right"><Skeleton variant="text" className="h-3 w-16 ml-auto" /></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700/50">
                        {[1, 2, 3, 4].map((i) => (
                            <tr key={i}>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <Skeleton variant="rectangular" className="w-10 h-10 rounded-xl" />
                                        <div>
                                            <Skeleton variant="text" className="h-4 w-24 mb-1" />
                                            <Skeleton variant="text" className="h-3 w-16" />
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4"><Skeleton variant="text" className="h-6 w-14 rounded-lg" /></td>
                                <td className="px-6 py-4 text-center"><Skeleton variant="text" className="h-6 w-10 rounded-lg mx-auto" /></td>
                                <td className="px-6 py-4 text-right">
                                    <Skeleton variant="text" className="h-4 w-16 ml-auto mb-1" />
                                    <Skeleton variant="text" className="h-3 w-14 ml-auto" />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function DashboardActivitySkeleton() {
    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
            <div className="space-y-6">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex gap-4">
                        <Skeleton variant="circular" className="w-[18px] h-[18px] mt-0.5" />
                        <div className="flex-1">
                            <Skeleton variant="text" className="h-4 w-full mb-2" />
                            <div className="flex items-center gap-2">
                                <Skeleton variant="text" className="h-3 w-16" />
                                <Skeleton variant="text" className="h-3 w-24" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function DashboardHeaderSkeleton() {
    return (
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
                <Skeleton variant="text" className="h-4 w-24 mb-2" />
                <Skeleton variant="text" className="h-8 w-32 mb-2" />
                <Skeleton variant="text" className="h-4 w-48" />
            </div>
            <div className="flex items-center gap-3">
                <Skeleton variant="rectangular" className="h-14 w-24 rounded-xl" />
                <Skeleton variant="rectangular" className="h-14 w-36 rounded-xl" />
            </div>
        </div>
    );
}

export function DashboardInitialSkeleton() {
    return (
        <div className="space-y-8">
            <DashboardHeaderSkeleton />
            <DashboardStatsSkeleton />
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2 space-y-4">
                    <div className="flex items-center justify-between">
                        <Skeleton variant="text" className="h-6 w-28" />
                        <Skeleton variant="text" className="h-4 w-20" />
                    </div>
                    <DashboardStreamsSkeleton />
                </div>
                <div className="space-y-4">
                    <Skeleton variant="text" className="h-6 w-24" />
                    <DashboardActivitySkeleton />
                </div>
            </div>
        </div>
    );
}
