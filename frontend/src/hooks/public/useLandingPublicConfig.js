import { useEffect, useMemo, useState } from 'react';
import { getPublicSaweriaConfig } from '../../services/saweriaService';
import { settingsService } from '../../services/settingsService';
import { DEFAULT_PUBLIC_ADS_CONFIG } from '../../components/ads/adsConfig';
import {
    DEFAULT_LANDING_SETTINGS,
    LANDING_SCHEDULE_RECHECK_MS,
    normalizeLandingSettings,
} from './landingScheduledContent';

export function useLandingPublicConfig() {
    const [saweriaLink, setSaweriaLink] = useState('https://saweria.co/raflialdi');
    const [saweriaLeaderboardLink, setSaweriaLeaderboardLink] = useState('');
    const [saweriaEnabled, setSaweriaEnabled] = useState(false);
    const [rawLandingSettings, setRawLandingSettings] = useState(DEFAULT_LANDING_SETTINGS);
    const [adsConfig, setAdsConfig] = useState(DEFAULT_PUBLIC_ADS_CONFIG);
    const [publicConfigLoading, setPublicConfigLoading] = useState(true);
    const [scheduleNow, setScheduleNow] = useState(() => Date.now());

    useEffect(() => {
        let isMounted = true;

        const loadPublicConfig = async () => {
            try {
                const [saweriaRes, landingRes, adsRes] = await Promise.all([
                    getPublicSaweriaConfig().catch((err) => {
                        console.warn('Saweria config fetch failed, using defaults:', err);
                        return { success: true, data: { enabled: false, saweria_link: null } };
                    }),
                    settingsService.getPublicLandingPageSettings().catch(() => ({ success: false })),
                    settingsService.getPublicAdsSettings().catch(() => ({ success: false })),
                ]);

                if (!isMounted) {
                    return;
                }

                if (saweriaRes?.data) {
                    setSaweriaEnabled(saweriaRes.data.enabled === true);
                    if (saweriaRes.data.saweria_link) {
                        setSaweriaLink(saweriaRes.data.saweria_link);
                    }
                    if (saweriaRes.data.leaderboard_link) {
                        setSaweriaLeaderboardLink(saweriaRes.data.leaderboard_link);
                    }
                }

                if (landingRes?.success && landingRes?.data) {
                    setRawLandingSettings(landingRes.data);
                }

                if (adsRes?.success && adsRes?.data) {
                    setAdsConfig(adsRes.data);
                }
            } catch (err) {
                if (isMounted) {
                    console.error('Failed to fetch public landing config:', err);
                }
            } finally {
                if (isMounted) {
                    setPublicConfigLoading(false);
                }
            }
        };

        loadPublicConfig();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setScheduleNow(Date.now());
        }, LANDING_SCHEDULE_RECHECK_MS);

        return () => {
            window.clearInterval(intervalId);
        };
    }, []);

    const landingSettings = useMemo(() => {
        return normalizeLandingSettings(rawLandingSettings, scheduleNow);
    }, [rawLandingSettings, scheduleNow]);

    return {
        saweriaEnabled,
        saweriaLink,
        saweriaLeaderboardLink,
        landingSettings,
        adsConfig,
        publicConfigLoading,
    };
}

export default useLandingPublicConfig;
