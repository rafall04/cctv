/*
 * Purpose: Choose a playback camera by picture, area, or search — instead of scrolling a 36-item list.
 * Caller: components/playback/PlaybackHeader.jsx.
 * Deps: React, ../ui/Modal (focus trap + Escape + scrim), ../CameraThumbnail, ../../utils/playbackCameraPicker.
 * MainFuncs: PlaybackCameraPicker.
 * SideEffects: Opens a modal dialog (which locks body scroll while mounted).
 *
 * WHY NOT A NATIVE <select>
 * It was one, grouped with <optgroup>. On a real Android phone that renders as a full-screen radio
 * list: names of 30+ characters wrap to three lines, and because <optgroup> children are indented,
 * only the FIRST wrapped line carries the indent — every continuation line starts hard against the
 * left edge. The result reads as broken layout. Grouping fixed the ORDER of the list but not the act
 * of choosing: it was still one long scroll with no way to narrow it.
 *
 * WHAT REPLACES IT
 * A dialog that lets a visitor arrive from whichever direction they already know:
 *   - by area   — chips, because most people know which town they want before which junction;
 *   - by name   — search that tolerates the operator's inconsistent naming (see the utils file);
 *   - by sight  — a thumbnail per row, which for a junction camera is usually faster than any name.
 * Rows own their own layout, so a long name clamps to two tidy lines instead of wrapping raggedly.
 *
 * Modal is imported from its file rather than the components/ui barrel on purpose: the barrel pulls
 * every admin primitive into what is a PUBLIC page chunk.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import CameraThumbnail from '../CameraThumbnail.jsx';
import {
    areaFacets,
    distinctLocation,
    filterByArea,
    filterCameras,
    groupCamerasByArea,
} from '../../utils/playbackCameraPicker.js';

function ChevronIcon() {
    return (
        <svg className="h-5 w-5 shrink-0 text-content-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
        </svg>
    );
}

function CheckIcon() {
    return (
        <svg className="h-5 w-5 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
    );
}

function SearchIcon() {
    return (
        <svg className="h-4 w-4 shrink-0 text-content-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
        </svg>
    );
}

function CameraRow({ camera, isSelected, revealOnMount, onPick }) {
    const rowRef = useRef(null);
    const location = distinctLocation(camera);

    // Open the dialog already showing where you are. Without this, picking the 30th camera means
    // reopening the list at the top every time. Only until the visitor searches or picks an area —
    // after that they are looking for something else, and yanking the list back to the current
    // camera would fight them.
    useEffect(() => {
        // Optional call, not just an optional ref: jsdom (and some older engines) do not implement
        // scrollIntoView at all, and a convenience scroll must never break the picker.
        if (revealOnMount) rowRef.current?.scrollIntoView?.({ block: 'center' });
    }, [revealOnMount]);

    return (
        <button
            ref={rowRef}
            type="button"
            onClick={() => onPick(camera)}
            aria-current={isSelected ? 'true' : undefined}
            title={camera.name}
            className={`flex w-full items-center gap-3 rounded-control px-2 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                isSelected ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-surface-raised'
            }`}
        >
            <span className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-control bg-surface-sunken">
                {/* isOffline is deliberately NOT passed: that flag is about the LIVE stream, and a
                    camera that is down right now can still hold hours of recordings. The last
                    capture is a truthful, useful picture of the spot either way. */}
                <CameraThumbnail
                    thumbnailPath={camera.external_snapshot_url || camera.thumbnail_path}
                    thumbnailVersion={camera.thumbnail_updated_at}
                    cameraName={camera.name}
                />
            </span>

            <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm font-medium leading-snug text-content">{camera.name}</span>
                {location && <span className="mt-0.5 block truncate text-xs text-content-muted">{location}</span>}
            </span>

            {isSelected && <CheckIcon />}
        </button>
    );
}

function PickerDialog({ cameras, selectedCamera, onPick, onClose }) {
    const [query, setQuery] = useState('');
    const [area, setArea] = useState('all');
    /* Once the visitor narrows the list, the dialog stops being "where am I" and becomes "find me
     * this" — which changes where the list should be scrolled. */
    const narrowed = query.trim() !== '' || area !== 'all';

    const facets = useMemo(() => areaFacets(cameras), [cameras]);
    const groups = useMemo(
        () => groupCamerasByArea(filterCameras(filterByArea(cameras, area), query)),
        [cameras, area, query],
    );
    const matchCount = groups.reduce((total, group) => total + group.cameras.length, 0);

    // Results start at the top. Without this the list kept the offset from revealing the current
    // camera, so the first matches — and the first area heading — sat scrolled off above.
    const bodyRef = useRef(null);
    useEffect(() => {
        if (narrowed && bodyRef.current) bodyRef.current.scrollTop = 0;
    }, [narrowed, query, area]);

    // Focusing the field on a phone opens the keyboard over the list the visitor came to look at.
    // On a pointer device there is no such cost, so type-to-search works immediately there.
    const searchRef = useRef(null);
    useEffect(() => {
        if (window.matchMedia?.('(min-width: 640px)').matches) searchRef.current?.focus();
    }, []);

    return (
        <Modal title="Pilih Kamera" onClose={onClose} size="md" bodyClassName="" bodyRef={bodyRef}>
            <div className="sticky top-0 z-10 space-y-2 border-b border-edge bg-surface-overlay px-3 pb-2 pt-3">
                <div className="flex items-center gap-2 rounded-control border border-edge bg-surface px-3 py-2 focus-within:border-transparent focus-within:ring-2 focus-within:ring-primary">
                    <SearchIcon />
                    <input
                        ref={searchRef}
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Cari nama atau lokasi kamera…"
                        aria-label="Cari kamera"
                        className="min-w-0 flex-1 bg-transparent text-sm text-content placeholder:text-content-subtle focus:outline-none"
                    />
                </div>

                {/* [contain:paint] — see LandingDiscoveryStrip: a horizontal strip's overflow
                    reaches the document's scrollable rect even through clipping ancestors. */}
                {facets.length > 2 && (
                    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [contain:paint]" role="group" aria-label="Saring per area">
                        {facets.map((facet) => {
                            const active = facet.key === area;
                            return (
                                <button
                                    key={facet.key}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => setArea(facet.key)}
                                    title={facet.label}
                                    className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                        active
                                            ? 'border-primary bg-primary text-white'
                                            : 'border-edge text-content-muted hover:border-edge-strong hover:text-content'
                                    }`}
                                >
                                    {/* Area names here run to 29 characters ("KEC BOJONEGORO DAN
                                        SEKITARNYA"), which pushed the last chip off the right edge
                                        and read as broken rather than as scrollable. Clamping the
                                        label keeps every chip visible at once; the count never
                                        truncates, and the full name stays in the tooltip. */}
                                    <span className="max-w-[8.5rem] truncate">{facet.label}</span>
                                    <span className="shrink-0 tabular-nums opacity-75">{facet.count}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="px-2 pb-3 pt-2">
                {matchCount === 0 ? (
                    <p className="px-2 py-8 text-center text-sm text-content-muted">
                        Tidak ada kamera yang cocok dengan pencarian itu.
                    </p>
                ) : (
                    groups.map((group) => (
                        <section key={group.area}>
                            {/* One visible area only (a chip is active, or there is genuinely one) makes
                                the heading a restatement of the chip — so it is dropped. */}
                            {groups.length > 1 && (
                                <h3 className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-content-subtle">
                                    {group.area}
                                </h3>
                            )}
                            <div className="space-y-0.5">
                                {group.cameras.map((camera) => {
                                    const isSelected = camera.id === selectedCamera?.id;
                                    return (
                                        <CameraRow
                                            key={camera.id}
                                            camera={camera}
                                            isSelected={isSelected}
                                            revealOnMount={isSelected && !narrowed}
                                            onPick={onPick}
                                        />
                                    );
                                })}
                            </div>
                        </section>
                    ))
                )}
            </div>
        </Modal>
    );
}

export default function PlaybackCameraPicker({ cameras, selectedCamera, onCameraChange }) {
    const [open, setOpen] = useState(false);
    const list = Array.isArray(cameras) ? cameras : [];

    const handlePick = (camera) => {
        setOpen(false);
        if (camera?.id !== selectedCamera?.id) onCameraChange(camera);
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={list.length === 0}
                aria-haspopup="dialog"
                aria-expanded={open}
                className="flex w-full items-center gap-3 rounded-control border border-edge bg-surface p-2 text-left transition-colors hover:border-edge-strong disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
                <span className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-control bg-surface-sunken">
                    {/* priority: this is one always-visible image identifying the camera you are
                        watching, so it should not queue behind lazy-loading heuristics the way the
                        36 images inside the dialog rightly do. */}
                    <CameraThumbnail
                        thumbnailPath={selectedCamera?.external_snapshot_url || selectedCamera?.thumbnail_path}
                        thumbnailVersion={selectedCamera?.thumbnail_updated_at}
                        cameraName={selectedCamera?.name || 'Kamera'}
                        priority
                    />
                </span>

                <span className="min-w-0 flex-1">
                    <span className="block text-[11px] uppercase tracking-wide text-content-subtle">
                        {list.length === 0 ? 'Kamera' : `Kamera · ${list.length} tersedia`}
                    </span>
                    <span className="line-clamp-2 text-sm font-semibold leading-snug text-content">
                        {selectedCamera?.name || 'Belum ada kamera'}
                    </span>
                    {selectedCamera?.area_name && (
                        <span className="block truncate text-xs text-content-muted">{selectedCamera.area_name}</span>
                    )}
                </span>

                <ChevronIcon />
            </button>

            {open && (
                <PickerDialog
                    cameras={list}
                    selectedCamera={selectedCamera}
                    onPick={handlePick}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}
