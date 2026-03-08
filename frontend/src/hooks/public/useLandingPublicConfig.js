import { useEffect, useState } from 'react';
import { getPublicSaweriaConfig } from '../../services/saweriaService';
import { settingsService } from '../../services/settingsService';

const DEFAULT_LANDING_SETTINGS = {
    area_coverage: 'Saat ini area coverage kami baru mencakup <strong>Dander</strong> dan <strong>Tanjungharjo</strong>',
    hero_badge: 'LIVE STREAMING 24 JAM',
    section_title: 'CCTV Publik',
    eventBanner: {
        enabled: false,
        title: '',
        text: '',
        theme: 'neutral',
        start_at: '',
        end_at: '',
        show_in_full: true,
        show_in_simple: true,
        isActive: false,
    },
    announcement: {
        enabled: false,
        title: '',
        text: '',
        style: 'info',
        start_at: '',
        end_at: '',
        show_in_full: true,
        show_in_simple: true,
        isActive: false,
    },
};

export function useLandingPublicConfig() {
    const [saweriaLink, setSaweriaLink] = useState('https://saweria.co/raflialdi');
    const [saweriaLeaderboardLink, setSaweriaLeaderboardLink] = useState('');
    const [saweriaEnabled, setSaweriaEnabled] = useState(false);
    const [landingSettings, setLandingSettings] = useState(DEFAULT_LANDING_SETTINGS);

    useEffect(() => {
        let isMounted = true;

        const loadPublicConfig = async () => {
            try {
                const [saweriaRes, landingRes] = await Promise.all([
                    getPublicSaweriaConfig().catch((err) => {
                        console.warn('Saweria config fetch failed, using defaults:', err);
                        return { success: true, data: { enabled: false, saweria_link: null } };
                    }),
                    settingsService.getPublicLandingPageSettings().catch(() => ({ success: false })),
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
                    setLandingSettings(landingRes.data);
                }
            } catch (err) {
                if (isMounted) {
                    console.error('Failed to fetch public landing config:', err);
                }
            }
        };

        loadPublicConfig();

        return () => {
            isMounted = false;
        };
    }, []);

    return {
        saweriaEnabled,
        saweriaLink,
        saweriaLeaderboardLink,
        landingSettings,
    };
}

export default useLandingPublicConfig;
