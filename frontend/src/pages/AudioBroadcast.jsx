/*
 * Purpose: Admin page for Audio Broadcast — send audio to camera speakers now, keep a clip library,
 *   build playlists, and schedule automatic broadcasts. Clean four-tab surface.
 * Caller: App.jsx route /admin/audio (admin only).
 * Deps: audioService, components/admin/audio/*, components/ui (PageHeader, Tabs), NotificationContext.
 * MainFuncs: AudioBroadcast.
 * SideEffects: reads/writes the Audio Broadcast API; broadcasts audio to cameras on user action.
 *
 * Backchannel reality (why "candidates", not "cameras"): audio rides the ONVIF backchannel, which
 * only some internal cameras expose (an IMOU PS3E does; an S41FE has a speaker but does not expose
 * it locally). So the camera list is every internal RTSP camera, and a camera without a working
 * backchannel simply reports its failure per play — the page never pretends all of them will sound.
 */

import { useCallback, useEffect, useState } from 'react';
import {
    getClips, getPlaylists, getSchedules, getCameras,
} from '../services/audioService';
import { useNotification } from '../contexts/NotificationContext';
import { PageHeader, Tabs, TabPanel } from '../components/ui';
import LibraryTab from '../components/admin/audio/LibraryTab';
import PlaylistTab from '../components/admin/audio/PlaylistTab';
import ScheduleTab from '../components/admin/audio/ScheduleTab';
import PlayNowTab from '../components/admin/audio/PlayNowTab';

const TABS = [
    { id: 'play', label: 'Putar Sekarang' },
    { id: 'library', label: 'Pustaka' },
    { id: 'playlists', label: 'Playlist' },
    { id: 'schedules', label: 'Jadwal' },
];

export default function AudioBroadcast() {
    const [active, setActive] = useState('play');
    const [clips, setClips] = useState([]);
    const [playlists, setPlaylists] = useState([]);
    const [schedules, setSchedules] = useState([]);
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [preselectClip, setPreselectClip] = useState(null);
    const { showNotification } = useNotification();

    const warn = useCallback((result, title) => {
        if (result && result.success === false) {
            showNotification({ type: 'error', title, message: result.message });
        }
    }, [showNotification]);

    const reloadClips = useCallback(async () => {
        const r = await getClips();
        if (r.success) setClips(r.data || []); else warn(r, 'Gagal memuat audio');
    }, [warn]);

    const reloadPlaylists = useCallback(async () => {
        const r = await getPlaylists();
        if (r.success) setPlaylists(r.data || []); else warn(r, 'Gagal memuat playlist');
    }, [warn]);

    const reloadSchedules = useCallback(async () => {
        const r = await getSchedules();
        if (r.success) setSchedules(r.data || []); else warn(r, 'Gagal memuat jadwal');
    }, [warn]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            const [c, p, s, cam] = await Promise.all([getClips(), getPlaylists(), getSchedules(), getCameras()]);
            if (cancelled) return;
            if (c.success) setClips(c.data || []); else warn(c, 'Gagal memuat audio');
            if (p.success) setPlaylists(p.data || []); else warn(p, 'Gagal memuat playlist');
            if (s.success) setSchedules(s.data || []); else warn(s, 'Gagal memuat jadwal');
            if (cam.success) setCameras(cam.data || []); else warn(cam, 'Gagal memuat kamera');
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [warn]);

    const playClipFromLibrary = (clip) => {
        setPreselectClip(clip);
        setActive('play');
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="Siaran Audio"
                description="Kirim audio ke speaker kamera — sekarang, atau terjadwal. Unggah audio sendiri, susun playlist, dan jadwalkan per kamera, jam, dan hari. Audio memakai jalur ONVIF backchannel, jadi hanya kamera yang mendukung two-way talk yang berbunyi."
            />

            <Tabs tabs={TABS} activeId={active} onChange={setActive} idPrefix="audio" />

            {active === 'play' && (
                <TabPanel id="play" idPrefix="audio">
                    <PlayNowTab clips={clips} playlists={playlists} cameras={cameras} preselect={preselectClip} />
                </TabPanel>
            )}
            {active === 'library' && (
                <TabPanel id="library" idPrefix="audio">
                    <LibraryTab clips={clips} loading={loading} reload={reloadClips} onPlayClip={playClipFromLibrary} />
                </TabPanel>
            )}
            {active === 'playlists' && (
                <TabPanel id="playlists" idPrefix="audio">
                    <PlaylistTab playlists={playlists} clips={clips} loading={loading} reload={reloadPlaylists} />
                </TabPanel>
            )}
            {active === 'schedules' && (
                <TabPanel id="schedules" idPrefix="audio">
                    <ScheduleTab
                        schedules={schedules}
                        clips={clips}
                        playlists={playlists}
                        cameras={cameras}
                        loading={loading}
                        reload={reloadSchedules}
                    />
                </TabPanel>
            )}
        </div>
    );
}
