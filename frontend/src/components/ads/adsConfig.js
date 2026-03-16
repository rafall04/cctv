export const DEFAULT_PUBLIC_ADS_CONFIG = {
    enabled: false,
    provider: 'adsterra',
    devices: {
        desktop: true,
        mobile: true,
    },
    slots: {
        socialBar: { enabled: false },
        topBanner: { enabled: false },
        afterCamerasNative: { enabled: false },
        popupTopBanner: { enabled: false },
        popupBottomNative: { enabled: false },
    },
};

export function isAdsMobileViewport() {
    if (typeof window === 'undefined') {
        return false;
    }

    return window.innerWidth < 768;
}

export function shouldRenderAdSlot(config, slotKey, isMobile) {
    if (!config?.enabled) {
        return false;
    }

    const desktopEnabled = config.devices?.desktop !== false;
    const mobileEnabled = config.devices?.mobile !== false;
    const slot = config.slots?.[slotKey];

    if (!slot?.enabled || !slot?.script) {
        return false;
    }

    if (isMobile) {
        return mobileEnabled;
    }

    return desktopEnabled;
}
