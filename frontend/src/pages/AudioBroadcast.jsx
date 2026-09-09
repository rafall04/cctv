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
    getClips, getPlaylists, getSchedules, getCameras, getAreas, getCapability,
    getGroups, createGroup, updateGroup, deleteGroup,
} from '../services/audioService';
import { useNotification } from '../contexts/NotificationContext';
import { PageHeader, Tabs, TabPanel } from '../components/ui';
import LibraryTab from '../components/admin/audio/LibraryTab';
import PlaylistTab from '../components/admin/audio/PlaylistTab';
import ScheduleTab from '../components/admin/audio/ScheduleTab';
import PlayNowTab from '../components/admin/audio/PlayNowTab';
import TargetsTab from '../components/admin/audio/TargetsTab';
import TalkTab from '../components/admin/audio/TalkTab';
import GroupsTab from '../components/admin/audio/GroupsTab';
import SoundboardTab from '../components/admin/audio/SoundboardTab';
import EmergencyPanel from '../components/admin/audio/EmergencyPanel';
import PrayerConfig from '../components/admin/audio/PrayerConfig';
import MotionArms from '../components/admin/audio/MotionArms';

const TABS = [
    { id: 'play', label: 'Putar Sekarang' },
    { id: 'panel', label: 'Panel' },
    { id: 'talk', label: 'Bicara' },
    { id: 'library', label: 'Pustaka' },
    { id: 'playlists', label: 'Playlist' },
    { id: 'groups', label: 'Grup' },
    { id: 'schedules', label: 'Jadwal' },
    { id: 'targets', label: 'Kamera & Area' },
];

export default function AudioBroadcast() {
    const [active, setActive] = useState('play');
    const [clips, setClips] = useState([]);
    const [playlists, setPlaylists] = useState([]);
    const [schedules, setSchedules] = useState([]);
    const [cameras, setCameras] = useState([]);
    const [areas, setAreas] = useState([]);
    const [capability, setCapability] = useState([]);
    const [groups, setGroups] = useState([]);
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

    // Reloading the scope also refreshes the camera picker — enabling an area changes who is a target.
    const reloadAreas = useCallback(async () => {
        const [ar, cam] = await Promise.all([getAreas(), getCameras()]);
        if (ar.success) setAreas(ar.data || []); else warn(ar, 'Gagal memuat area');
        if (cam.success) setCameras(cam.data || []);
    }, [warn]);

    const reloadCapability = useCallback(async () => {
        const [cap, cam] = await Promise.all([getCapability(), getCameras()]);
        if (cap.success) setCapability(cap.data || []); else warn(cap, 'Gagal memuat kapabilitas');
        if (cam.success) setCameras(cam.data || []);
    }, [warn]);

    const reloadGroups = useCallback(async () => {
        const r = await getGroups();
        if (r.success) setGroups(r.data || []); else warn(r, 'Gagal memuat grup');
    }, [warn]);

    // Save the current camera selection as a custom manual group; delete removes it. Both refresh the list.
    const handleSaveGroup = useCallback(async (name, cameraIds) => {
        const r = await createGroup(name, cameraIds);
        if (r.success) { showNotification({ type: 'success', title: 'Grup disimpan', message: name }); reloadGroups(); }
        else warn(r, 'Gagal membuat grup');
    }, [reloadGroups, warn, showNotification]);

    const handleUpdateGroup = useCallback(async (id, payload) => {
        const r = await updateGroup(id, payload);
        if (r.success) { showNotification({ type: 'success', title: 'Grup diperbarui' }); reloadGroups(); }
        else warn(r, 'Gagal memperbarui grup');
    }, [reloadGroups, warn, showNotification]);

    const handleDeleteGroup = useCallback(async (id) => {
        const r = await deleteGroup(id);
        if (r.success) reloadGroups(); else warn(r, 'Gagal menghapus grup');
    }, [reloadGroups, warn]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            const [c, p, s, cam, ar, cap, gr] = await Promise.all([
                getClips(), getPlaylists(), getSchedules(), getCameras(), getAreas(), getCapability(), getGroups(),
            ]);
            if (cancelled) return;
            if (c.success) setClips(c.data || []); else warn(c, 'Gagal memuat audio');
            if (p.success) setPlaylists(p.data || []); else warn(p, 'Gagal memuat playlist');
            if (s.success) setSchedules(s.data || []); else warn(s, 'Gagal memuat jadwal');
            if (cam.success) setCameras(cam.data || []); else warn(cam, 'Gagal memuat kamera');
            if (ar.success) setAreas(ar.data || []);
            if (cap.success) setCapability(cap.data || []);
            if (gr.success) setGroups(gr.data || []);
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
                    <PlayNowTab
                        clips={clips}
                        playlists={playlists}
                        cameras={cameras}
                        preselect={preselectClip}
                        groups={groups}
                        onSaveGroup={handleSaveGroup}
                    />
                </TabPanel>
            )}
            {active === 'panel' && (
                <TabPanel id="panel" idPrefix="audio">
                    <div className="space-y-6">
                        <EmergencyPanel clips={clips} playlists={playlists} cameras={cameras} areas={areas} />
                        <SoundboardTab clips={clips} playlists={playlists} cameras={cameras} />
                    </div>
                </TabPanel>
            )}
            {active === 'talk' && (
                <TabPanel id="talk" idPrefix="audio">
                    <TalkTab cameras={cameras} />
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
            {active === 'groups' && (
                <TabPanel id="groups" idPrefix="audio">
                    <GroupsTab
                        groups={groups}
                        cameras={cameras}
                        onSaveGroup={handleSaveGroup}
                        onUpdateGroup={handleUpdateGroup}
                        onDeleteGroup={handleDeleteGroup}
                    />
                </TabPanel>
            )}
            {active === 'schedules' && (
                <TabPanel id="schedules" idPrefix="audio">
                  <div className="space-y-6">
                    <PrayerConfig clips={clips} areas={areas} />
                    <ScheduleTab
                        schedules={schedules}
                        clips={clips}
                        playlists={playlists}
                        cameras={cameras}
                        loading={loading}
                        reload={reloadSchedules}
                        groups={groups}
                        onSaveGroup={handleSaveGroup}
                    />
                  </div>
                </TabPanel>
            )}
            {active === 'targets' && (
                <TabPanel id="targets" idPrefix="audio">
                  <div className="space-y-6">
                    <TargetsTab
                        areas={areas}
                        capability={capability}
                        loading={loading}
                        reloadAreas={reloadAreas}
                        reloadCapability={reloadCapability}
                    />
                    <MotionArms capability={capability} clips={clips} />
                  </div>
                </TabPanel>
            )}
        </div>
    );
}
