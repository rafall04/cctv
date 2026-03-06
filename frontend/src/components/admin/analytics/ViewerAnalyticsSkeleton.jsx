import { Skeleton } from '../../ui/Skeleton';

export default function ViewerAnalyticsSkeleton() {
    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <Skeleton variant="text" className="h-4 w-24 mb-2" />
                    <Skeleton variant="text" className="h-8 w-48 mb-2" />
                    <Skeleton variant="text" className="h-4 w-64" />
                </div>
                <Skeleton variant="rectangular" className="h-10 w-64 rounded-xl" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {[1, 2, 3, 4].map((item) => (
                    <div key={item} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-4">
                            <Skeleton className="w-12 h-12 rounded-xl" />
                            <Skeleton className="w-16 h-3" />
                        </div>
                        <Skeleton className="w-24 h-9 mb-2" />
                        <Skeleton className="w-32 h-4" />
                    </div>
                ))}
            </div>
        </div>
    );
}
