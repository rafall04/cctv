export const DEFAULT_PUBLIC_ADS_CONFIG = {
    enabled: false,
    provider: 'adsterra',
    devices: {
        desktop: true,
        mobile: true,
    },
    popup: {
        enabled: true,
        preferredSlot: 'bottom',
        hideSocialBarOnPopup: true,
        hideFloatingWidgetsOnPopup: true,
        maxHeight: {
            desktop: 160,
            mobile: 220,
        },
    },
    slots: {
        playbackPopunder: {
            enabled: false,
            devices: {
                desktop: true,
                mobile: true,
            },
        },
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
    const slotDesktopEnabled = slot?.devices?.desktop !== false;
    const slotMobileEnabled = slot?.devices?.mobile !== false;

    if (!slot?.enabled || !slot?.script) {
        return false;
    }

    if (isMobile) {
        return mobileEnabled && slotMobileEnabled;
    }

    return desktopEnabled && slotDesktopEnabled;
}

export function getPopupMaxHeight(config, isMobile) {
    const popupConfig = config?.popup;
    if (!popupConfig?.maxHeight) {
        return isMobile
            ? DEFAULT_PUBLIC_ADS_CONFIG.popup.maxHeight.mobile
            : DEFAULT_PUBLIC_ADS_CONFIG.popup.maxHeight.desktop;
    }

    return isMobile
        ? popupConfig.maxHeight.mobile || DEFAULT_PUBLIC_ADS_CONFIG.popup.maxHeight.mobile
        : popupConfig.maxHeight.desktop || DEFAULT_PUBLIC_ADS_CONFIG.popup.maxHeight.desktop;
}
