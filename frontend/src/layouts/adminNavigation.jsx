/*
 * Purpose: Admin navigation model — the grouped route list, the icon set, and the filter helper.
 * Caller: layouts/AdminLayout.jsx (and its test).
 * Deps: React only (icons are inline SVG; no icon package is installed).
 * MainFuncs: NAV_GROUPS, DOCK_ACTIONS, AdminIcons, filterNavGroups.
 * SideEffects: None — pure data + presentational icons.
 *
 * Why this is a separate module: the sidebar was 23 undifferentiated links in one flat list, about
 * 1,150px of nav in a viewport that is usually ~800px, so reaching Pengaturan always meant
 * scrolling. Grouping is the fix, but grouping plus one distinct icon per destination is a lot of
 * markup — keeping it out of the shell leaves AdminLayout readable and lets the grouping be tested
 * on its own.
 *
 * Two rules encoded here:
 *  - ONE icon per destination. The old set reused a single "Analytics" glyph for four unrelated
 *    routes, so the icon column carried no information.
 *  - ONE language. Labels mixed English and Indonesian ("Cameras" next to "Billing Pelanggan");
 *    the product is Indonesian, so the nav is Indonesian throughout.
 */

// Named function expression, not a bare arrow: React (and eslint's display-name rule) need a
// component name, and every call returns a distinct component so the nav can be checked for
// icon reuse by reference.
const ico = (path) => function AdminIcon() {
    return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            {path}
        </svg>
    );
};

const p = (d) => <path strokeLinecap="round" strokeLinejoin="round" d={d} />;

export const AdminIcons = {
    Dashboard: ico(p('M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z')),
    Camera: ico(p('M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z')),
    Area: ico(<>{p('M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z')}{p('M15 11a3 3 0 11-6 0 3 3 0 016 0z')}</>),
    Ronda: ico(<>{p('M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2')}{p('M12 10a2 2 0 100 4 2 2 0 000-4z')}</>),
    Pulse: ico(p('M3 12h3l2.5-7 4 14 2.5-7H21')),
    Recording: ico(<>{p('M7 4v16M17 4v16M3 8h4m10 0h4M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z')}</>),
    Playback: ico(<>{p('M14.752 11.168l-4.197-2.432A1 1 0 009 9.602v4.796a1 1 0 001.555.832l4.197-2.432a1 1 0 000-1.73z')}{p('M21 12a9 9 0 11-18 0 9 9 0 0118 0z')}</>),
    Key: ico(p('M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z')),
    Library: ico(<>{p('M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5z')}{p('M10 9l5 3-5 3V9z')}</>),
    Archive: ico(<>{p('M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8')}{p('M10 12h4')}</>),
    ChartBar: ico(p('M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z')),
    ChartLine: ico(<>{p('M3 3v18h18')}{p('M7 14l3.5-4 3 2.5L21 6')}</>),
    Billing: ico(<>{p('M3 10h18M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z')}{p('M7 15h3')}</>),
    Voucher: ico(<>{p('M4 8a2 2 0 012-2h12a2 2 0 012 2v1a2 2 0 000 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2v-1a2 2 0 000-4V8z')}{p('M14 8v8')}</>),
    Network: ico(<>{p('M12 4a2 2 0 100 4 2 2 0 000-4zM5 16a2 2 0 100 4 2 2 0 000-4zM19 16a2 2 0 100 4 2 2 0 000-4z')}{p('M12 8v4m0 0l-5 4m5-4l5 4')}</>),
    Sponsor: ico(p('M11 5.882V19.24a1 1 0 01-1.447.894L5 17.764V8.236l4.553-2.37A1 1 0 0111 5.882zM5 8.236H4a2 2 0 00-2 2v3.528a2 2 0 002 2h1M15 7a5 5 0 010 10')),
    Ads: ico(<>{p('M4 5h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z')}{p('M9 21h6M12 17v4')}</>),
    Users: ico(p('M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z')),
    Shield: ico(p('M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z')),
    Bell: ico(p('M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0m6 0H9')),
    Transfer: ico(p('M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4')),
    Backup: ico(<>{p('M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3-3.582 3-8 3-8-1.343-8-3z')}{p('M4 7v10c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12c0 1.657 3.582 3 8 3s8-1.343 8-3')}</>),
    Feedback: ico(p('M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z')),
    Settings: ico(<>{p('M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z')}{p('M15 12a3 3 0 11-6 0 3 3 0 016 0z')}</>),

    // Shell chrome (not destinations).
    Home: ico(p('M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6')),
    Menu: ico(p('M4 6h16M4 12h16m-7 6h7')),
    Close: ico(p('M6 18L18 6M6 6l12 12')),
    Sun: ico(<><circle cx="12" cy="12" r="4" />{p('M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41')}</>),
    Moon: ico(p('M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z')),
    Logout: ico(p('M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1')),
    Search: ico(p('M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z')),
    External: ico(p('M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14')),
};

/**
 * Grouped destinations. `adminOnly` items are hidden from viewer accounts — the route guard and
 * the backend enforce it too; hiding just keeps the nav honest about what this account can reach.
 */
export const NAV_GROUPS = [
    {
        id: 'operasi',
        label: 'Operasi',
        items: [
            { label: 'Dashboard', path: '/admin/dashboard', icon: AdminIcons.Dashboard },
            { label: 'Kamera', path: '/admin/cameras', icon: AdminIcons.Camera },
            { label: 'Area', path: '/admin/areas', icon: AdminIcons.Area },
            { label: 'Ronda Digital', path: '/admin/ronda', icon: AdminIcons.Ronda, adminOnly: true },
            { label: 'Diagnostik Kamera', path: '/admin/health-debug', icon: AdminIcons.Pulse },
        ],
    },
    {
        id: 'rekaman',
        label: 'Rekaman',
        items: [
            { label: 'Rekaman', path: '/admin/recordings', icon: AdminIcons.Recording },
            { label: 'Putar Ulang', path: '/admin/playback', icon: AdminIcons.Playback },
            { label: 'Token Putar Ulang', path: '/admin/playback-tokens', icon: AdminIcons.Key, adminOnly: true },
            { label: 'Arsip Rekaman', path: '/admin/arsip', icon: AdminIcons.Library, adminOnly: true },
            { label: 'Arsip ke Telegram', path: '/admin/telegram-archive', icon: AdminIcons.Archive, adminOnly: true },
        ],
    },
    {
        id: 'analitik',
        label: 'Analitik',
        items: [
            { label: 'Analitik Penonton', path: '/admin/analytics', icon: AdminIcons.ChartBar },
            { label: 'Analitik Putar Ulang', path: '/admin/playback-analytics', icon: AdminIcons.ChartLine },
        ],
    },
    {
        id: 'pelanggan',
        label: 'Pelanggan',
        items: [
            { label: 'Billing Pelanggan', path: '/admin/billing', icon: AdminIcons.Billing, adminOnly: true },
            { label: 'Voucher Akses', path: '/admin/voucher', icon: AdminIcons.Voucher, adminOnly: true },
            { label: 'IP Kamera (Routing)', path: '/admin/customer-ips', icon: AdminIcons.Network, adminOnly: true },
            { label: 'Sponsor', path: '/admin/sponsors', icon: AdminIcons.Sponsor, adminOnly: true },
            { label: 'Iklan', path: '/admin/ads', icon: AdminIcons.Ads, adminOnly: true },
        ],
    },
    {
        id: 'sistem',
        label: 'Sistem',
        items: [
            { label: 'Pengguna', path: '/admin/users', icon: AdminIcons.Users, adminOnly: true },
            { label: 'Aktivitas Keamanan', path: '/admin/security', icon: AdminIcons.Shield, adminOnly: true },
            { label: 'Diagnostik Notifikasi', path: '/admin/notification-diagnostics', icon: AdminIcons.Bell, adminOnly: true },
            { label: 'Impor/Ekspor', path: '/admin/import-export', icon: AdminIcons.Transfer, adminOnly: true },
            { label: 'Cadangan & Pulihkan', path: '/admin/backup-restore', icon: AdminIcons.Backup, adminOnly: true },
            { label: 'Masukan', path: '/admin/feedback', icon: AdminIcons.Feedback },
            { label: 'Pengaturan', path: '/admin/settings', icon: AdminIcons.Settings, adminOnly: true },
        ],
    },
];

/** Mobile dock: the five destinations an operator actually reaches for on a phone. */
export const DOCK_ACTIONS = (isAdmin) => [
    { label: 'Dashboard', path: '/admin/dashboard', icon: AdminIcons.Dashboard },
    { label: 'Kamera', path: '/admin/cameras', icon: AdminIcons.Camera },
    { label: 'Diagnostik', path: '/admin/health-debug', icon: AdminIcons.Pulse },
    isAdmin
        ? { label: 'Token', path: '/admin/playback-tokens', icon: AdminIcons.Key }
        : { label: 'Rekaman', path: '/admin/recordings', icon: AdminIcons.Recording },
    { label: 'Publik', path: '/', icon: AdminIcons.Home },
];

/**
 * Apply the role filter and the sidebar search in one pass, dropping any group left empty so a
 * search never leaves a bare heading behind.
 *
 * @param {boolean} isAdmin
 * @param {string} query free-text filter over labels
 */
export function filterNavGroups(isAdmin, query = '') {
    const needle = query.trim().toLowerCase();
    return NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter(
            (item) => (isAdmin || !item.adminOnly) && (!needle || item.label.toLowerCase().includes(needle)),
        ),
    })).filter((group) => group.items.length > 0);
}
