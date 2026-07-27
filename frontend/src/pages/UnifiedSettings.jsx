/*
Purpose: Admin settings route — one panel at a time, each loaded on demand.
Caller: App.jsx protected /admin/settings route.
Deps: React lazy/Suspense, components/ui (PageHeader, Tabs, TabPanel, Skeleton), settings panels.
MainFuncs: UnifiedSettings.
SideEffects: Loads the selected panel's chunk on first visit to that tab.

Two problems fixed here:

  - WEIGHT. All nine panels were imported statically, so opening Settings pulled every panel —
    Telegram, Ads, General, Branding, Backup, the lot — into one 84 KB chunk, the largest in the
    admin build, to render ONE of them. They are lazy now: the route ships the shell, and each tab
    fetches its own panel the first time it is opened. Ads config already lives on its own page
    (/admin/ads); only the entry point moved, AdsSettingsPanel is still the component.

  - SEMANTICS. The strip was nine plain <button>s — no role="tab", no aria-selected — so a screen
    reader announced "nine buttons" with no indication which panel was showing. The active tab was
    also hardcoded to sky-500, which meant the one colour an operator can rebrand at runtime was
    the one colour this page ignored. Both are handled by the shared Tabs primitive.
*/

import { lazy, Suspense, useState } from 'react';
import { PageHeader, Tabs, TabPanel } from '../components/ui';
import { FormSkeleton } from '../components/ui/Skeleton';

const GeneralSettingsPanel = lazy(() => import('../components/admin/settings/GeneralSettingsPanel'));
const TimezoneSettingsTab = lazy(() => import('../components/admin/settings/TimezoneSettingsTab'));
const BackupSettingsTab = lazy(() => import('../components/admin/settings/BackupSettingsTab'));
const StreamHealthSettingsPanel = lazy(() => import('../components/admin/settings/StreamHealthSettingsPanel'));
const PlaybackSettingsPanel = lazy(() => import('../components/admin/settings/PlaybackSettingsPanel'));
const TelegramSettingsPanel = lazy(() => import('../components/admin/settings/TelegramSettingsPanel'));
const SaweriaSettingsPanel = lazy(() => import('../components/admin/settings/SaweriaSettingsPanel'));
const BrandingSettingsPanel = lazy(() => import('../components/admin/settings/BrandingSettingsPanel'));
const ApiKeySettings = lazy(() => import('../components/admin/settings/ApiKeySettings'));

const TABS = [
    { id: 'general', label: 'Umum', Panel: GeneralSettingsPanel },
    { id: 'timezone', label: 'Zona Waktu', Panel: TimezoneSettingsTab },
    { id: 'backup', label: 'Cadangan', Panel: BackupSettingsTab },
    { id: 'health', label: 'Kesehatan Stream', Panel: StreamHealthSettingsPanel },
    { id: 'playback', label: 'Putar Ulang', Panel: PlaybackSettingsPanel },
    { id: 'telegram', label: 'Bot Telegram', Panel: TelegramSettingsPanel },
    { id: 'saweria', label: 'Saweria', Panel: SaweriaSettingsPanel },
    { id: 'branding', label: 'Branding', Panel: BrandingSettingsPanel },
    { id: 'apikey', label: 'Kunci API', Panel: ApiKeySettings },
];

export default function UnifiedSettings() {
    const [activeTab, setActiveTab] = useState('general');
    const active = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];
    const ActivePanel = active.Panel;

    return (
        <div className="space-y-5">
            <PageHeader
                title="Pengaturan Sistem"
                description="Konfigurasi dan integrasi sistem CCTV."
            />

            <Tabs
                tabs={TABS.map(({ id, label }) => ({ id, label }))}
                activeId={active.id}
                onChange={setActiveTab}
                idPrefix="settings"
            />

            <TabPanel id={active.id} idPrefix="settings">
                <Suspense fallback={<FormSkeleton />}>
                    <ActivePanel />
                </Suspense>
            </TabPanel>
        </div>
    );
}
