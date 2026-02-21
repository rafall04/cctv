import { useRef } from 'react';

export default function PlaybackTimeline({
    segments,
    selectedSegment,
    onSegmentClick,
    onTimelineClick,
    formatTimestamp,
}) {
    const timelineRef = useRef(null);

    const getTimelineData = () => {
        if (segments.length === 0) return { start: null, end: null, duration: 0, gaps: [], sortedSegments: [] };

        const sortedSegments = [...segments].sort((a, b) => 
            new Date(a.start_time) - new Date(b.start_time)
        );

        const start = new Date(sortedSegments[0].start_time);
        const end = new Date(sortedSegments[sortedSegments.length - 1].end_time);
        const duration = (end - start) / 1000;

        const gaps = [];
        for (let i = 0; i < sortedSegments.length - 1; i++) {
            const currentEnd = new Date(sortedSegments[i].end_time);
            const nextStart = new Date(sortedSegments[i + 1].start_time);
            const gapDuration = (nextStart - currentEnd) / 1000;
            
            if (gapDuration > 30) {
                gaps.push({
                    start: currentEnd,
                    end: nextStart,
                    duration: gapDuration
                });
            }
        }

        return { start, end, duration, gaps, sortedSegments };
    };

    const timelineData = getTimelineData();

    const handleTimelineClick = (e) => {
        if (!timelineRef.current || !timelineData.duration) return;
        
        const rect = timelineRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = clickX / rect.width;
        const targetTime = percentage * timelineData.duration;
        
        onTimelineClick(targetTime);
    };

    if (!timelineData.start) return null;

    return (
        <div className="bg-white dark:bg-gray-900 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-6 shadow-lg">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">Timeline</h2>
            
            <div className="mb-4 sm:mb-6">
                <div className="flex justify-between text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-2">
                    <span>{timelineData.start.toLocaleTimeString('id-ID')}</span>
                    <span>{timelineData.end.toLocaleTimeString('id-ID')}</span>
                </div>
                
                <div 
                    ref={timelineRef}
                    onClick={handleTimelineClick}
                    className="relative h-8 sm:h-10 md:h-12 bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer"
                >
                    {timelineData.sortedSegments.map((segment, idx) => {
                        const segmentStart = new Date(segment.start_time);
                        const segmentEnd = new Date(segment.end_time);
                        const startOffset = ((segmentStart - timelineData.start) / 1000 / timelineData.duration) * 100;
                        const width = ((segmentEnd - segmentStart) / 1000 / timelineData.duration) * 100;
                        
                        return (
                            <div
                                key={segment.id ?? `segment-${idx}`}
                                onClick={(e) => { e.stopPropagation(); onSegmentClick(segment); }}
                                className={`absolute h-full cursor-pointer transition-colors ${
                                    selectedSegment?.id === segment.id
                                        ? 'bg-primary-500'
                                        : 'bg-emerald-500 hover:bg-emerald-600'
                                }`}
                                style={{
                                    left: `${startOffset}%`,
                                    width: `${width}%`
                                }}
                                title={`${formatTimestamp(segment.start_time)} - ${formatTimestamp(segment.end_time)}`}
                            />
                        );
                    })}
                    
                    {timelineData.gaps.map((gap, index) => {
                        const startOffset = ((gap.start - timelineData.start) / 1000 / timelineData.duration) * 100;
                        const width = ((gap.end - gap.start) / 1000 / timelineData.duration) * 100;
                        
                        return (
                            <div
                                key={`gap-${index}`}
                                className="absolute h-full bg-red-500/30"
                                style={{
                                    left: `${startOffset}%`,
                                    width: `${width}%`
                                }}
                                title={`Missing: ${Math.round(gap.duration / 60)} minutes`}
                            />
                        );
                    })}
                </div>
                
                <div className="flex items-center gap-6 mt-3 text-xs text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-emerald-500 rounded"></div>
                        <span>Available</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-primary-500 rounded"></div>
                        <span>Playing</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-red-500/30 rounded"></div>
                        <span>Missing</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
