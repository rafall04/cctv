import TopCamerasCard from './TopCamerasCard';
import DeviceBreakdownCard from './DeviceBreakdownCard';
import TopVisitorsCard from './TopVisitorsCard';
import PeakHoursCard from './PeakHoursCard';

export default function ViewerAnalyticsAudienceSection({
    topCameras,
    deviceBreakdown,
    topVisitors,
    peakHours,
    onExportVisitors,
}) {
    return (
        <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <TopCamerasCard topCameras={topCameras} />
                <DeviceBreakdownCard deviceBreakdown={deviceBreakdown} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <TopVisitorsCard topVisitors={topVisitors} onExport={onExportVisitors} />
                <PeakHoursCard peakHours={peakHours} />
            </div>
        </>
    );
}
