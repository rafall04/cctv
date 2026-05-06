/*
 * Purpose: Provide pure ranking helpers for public area pages.
 * Caller: AreaPublicPage and related public area tests.
 * Deps: None.
 * MainFuncs: getAreaCameraLiveViewers, getAreaCameraTotalViews, buildAreaPublicRankingLists.
 * SideEffects: None.
 */

export function getAreaCameraLiveViewers(camera) {
    return Number(camera?.live_viewers || camera?.viewer_stats?.live_viewers || 0);
}

export function getAreaCameraTotalViews(camera) {
    return Number(camera?.total_views || camera?.viewer_stats?.total_views || 0);
}

function sortByNewest(left, right) {
    const rightCreated = String(right?.created_at || '');
    const leftCreated = String(left?.created_at || '');
    const byCreated = rightCreated.localeCompare(leftCreated);
    if (byCreated !== 0) {
        return byCreated;
    }

    return Number(right?.id || 0) - Number(left?.id || 0);
}

export function buildAreaPublicRankingLists(cameras = [], trendingCameras = [], selectedCamera = null) {
    const liveCameras = [...cameras]
        .filter((camera) => getAreaCameraLiveViewers(camera) > 0)
        .sort((left, right) => getAreaCameraLiveViewers(right) - getAreaCameraLiveViewers(left))
        .slice(0, 4);

    const topSource = trendingCameras.length ? trendingCameras : cameras;
    const topCameras = [...topSource]
        .sort((left, right) => getAreaCameraTotalViews(right) - getAreaCameraTotalViews(left))
        .slice(0, 4);

    const newestCameras = [...cameras]
        .filter((camera) => camera.created_at)
        .sort(sortByNewest)
        .slice(0, 4);

    const relatedPopupCameras = selectedCamera
        ? [...cameras]
            .filter((camera) => camera.id !== selectedCamera.id)
            .sort((left, right) => {
                const liveDelta = getAreaCameraLiveViewers(right) - getAreaCameraLiveViewers(left);
                if (liveDelta !== 0) {
                    return liveDelta;
                }

                return getAreaCameraTotalViews(right) - getAreaCameraTotalViews(left);
            })
            .slice(0, 5)
        : [];

    return {
        liveCameras,
        topCameras,
        newestCameras,
        relatedPopupCameras,
    };
}
