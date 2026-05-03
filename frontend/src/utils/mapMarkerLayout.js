/**
 * Purpose: Provides pure marker layout helpers for public map camera markers.
 * Caller: MapView marker rendering.
 * Deps: None.
 * MainFuncs: applyMarkerOffset.
 * SideEffects: None; returns cloned camera objects with display coordinate metadata.
 */
const DEFAULT_STACKED_MARKER_OFFSET = 0.0003;

export function applyMarkerOffset(cameras = [], offset = DEFAULT_STACKED_MARKER_OFFSET) {
    const coordMap = new Map();

    return cameras.map((camera) => {
        const lat = parseFloat(camera.latitude);
        const lng = parseFloat(camera.longitude);
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;

        if (!coordMap.has(key)) {
            coordMap.set(key, []);
        }

        const group = coordMap.get(key);
        const index = group.length;
        group.push(camera.id);

        if (index > 0) {
            const angle = (index * 60) * (Math.PI / 180);
            return {
                ...camera,
                _displayLat: lat + (offset * Math.cos(angle)),
                _displayLng: lng + (offset * Math.sin(angle)),
                _isGrouped: true,
                _groupIndex: index,
            };
        }

        return {
            ...camera,
            _displayLat: lat,
            _displayLng: lng,
            _isGrouped: false,
            _groupIndex: 0,
        };
    });
}
