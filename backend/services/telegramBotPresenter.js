/**
 * Purpose: Pure presentation layer for the interactive Telegram bot — builds message
 *          text + inline keyboards, encodes/decodes callback payloads, parses commands.
 *          No I/O, no database, no Telegram API: every function is deterministic and
 *          easily unit-tested. telegramBotService composes these with live data.
 * Caller: telegramBotService.
 * Deps: none.
 * MainFuncs: parseCommand, encodeCallback, decodeCallback, build* message builders.
 * SideEffects: none (pure).
 */

// Versioned prefix so a future payload format can be told apart from stale taps
// still sitting in a chat after a deploy. Keep codes short — Telegram caps
// callback_data at 64 bytes.
export const CALLBACK_VERSION = 't1';

export const ACTIONS = {
    APPROVE: 'appr',
    REJECT: 'rej',
    CUSTOMER: 'cust',
    CUSTOMERS_PAGE: 'cpag',
    SUSPEND_CONFIRM: 'csp',
    SUSPEND_EXEC: 'xsp',
    RESUME_EXEC: 'rsm',
    PLAN_OPTIONS: 'pln',
    PLAN_SET: 'spl',
    TOPUP_AMOUNTS: 'tua',
    TOPUP_CONFIRM: 'tuc',
    TOPUP_EXEC: 'xtu',
    BACK: 'bk',
    DISMISS: 'non',
};

// Preset top-up amounts (rupiah) surfaced as one-tap buttons in customer detail.
export const TOPUP_PRESETS = [25000, 50000, 100000, 250000];

/** Encode a callback payload: `t1:action:p1:p2`. Params are coerced to strings. */
export function encodeCallback(action, ...params) {
    return [CALLBACK_VERSION, action, ...params.map((p) => String(p))].join(':');
}

/** Decode callback_data → { action, params: string[] } or null when not ours/malformed. */
export function decodeCallback(data) {
    if (typeof data !== 'string' || !data) {
        return null;
    }
    const parts = data.split(':');
    if (parts[0] !== CALLBACK_VERSION || parts.length < 2) {
        return null;
    }
    return { action: parts[1], params: parts.slice(2) };
}

/**
 * Parse an incoming text message into a command. Returns null for non-commands.
 * Strips a trailing `@BotName` (groups append it) and lowercases the verb.
 */
export function parseCommand(text) {
    if (typeof text !== 'string') {
        return null;
    }
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) {
        return null;
    }
    const tokens = trimmed.slice(1).split(/\s+/);
    const command = tokens[0].split('@')[0].toLowerCase();
    if (!command) {
        return null;
    }
    const args = tokens.slice(1);
    return { command, args, argsText: args.join(' ') };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function formatRupiah(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) {
        return 'Rp0';
    }
    return `Rp${Math.round(n).toLocaleString('id-ID')}`;
}

const ACCOUNT_STATUS_LABELS = {
    approved: '✅ Disetujui',
    pending: '⏳ Menunggu persetujuan',
    rejected: '⛔ Ditolak',
};

export function accountStatusLabel(status) {
    return ACCOUNT_STATUS_LABELS[status] || status || '-';
}

function planLabel(plan) {
    if (!plan) {
        return 'Tanpa paket';
    }
    const trial = plan.is_trial ? ' (trial)' : '';
    return `${plan.name}${trial}`;
}

function inlineKeyboard(rows) {
    return { inline_keyboard: rows.filter((row) => Array.isArray(row) && row.length > 0) };
}

function btn(text, action, ...params) {
    return { text, callback_data: encodeCallback(action, ...params) };
}

// ---------------------------------------------------------------------------
// Message builders — each returns { text } or { text, reply_markup }
// ---------------------------------------------------------------------------

export function buildHelpMessage({ authorized, chatId, writeEnabled = {} } = {}) {
    const lines = [
        '<b>🤖 RAF NET — Bot Pengelola Pelanggan</b>',
        '',
        authorized
            ? 'Chat ini <b>diizinkan</b> mengelola pelanggan. Perintah tersedia:'
            : '⚠️ Chat ini <b>belum diizinkan</b>. Minta admin menambahkan Chat ID berikut ke daftar di pengaturan Telegram.',
        '',
    ];

    if (authorized) {
        lines.push(
            '<b>Pelanggan</b>',
            '/pending — daftar pendaftaran menunggu persetujuan',
            '/customers [cari] — daftar pelanggan (bisa cari nama/HP)',
            '/customer &lt;id|username&gt; — detail satu pelanggan',
            '/stats — ringkasan operasional & tagihan',
            '',
            '<b>Aksi cepat</b>',
        );
        if (writeEnabled.topup !== false) {
            lines.push('/topup &lt;id&gt; &lt;jumlah&gt; — tambah saldo (perlu konfirmasi)');
        }
        if (writeEnabled.suspendResume !== false) {
            lines.push('/suspend &lt;id&gt; — hentikan layanan · /resume &lt;id&gt; — aktifkan lagi');
        }
        if (writeEnabled.changePlan !== false) {
            lines.push('/plan &lt;id&gt; — ubah paket pelanggan');
        }
        lines.push(
            '',
            'Persetujuan & aksi lain juga tersedia lewat tombol di bawah pesan.',
        );
    }

    lines.push('', `Chat ID Anda: <code>${escapeHtml(chatId)}</code>`);
    return { text: lines.join('\n') };
}

export function buildUnauthorizedNotice(chatId) {
    return {
        text: [
            '⛔ <b>Tidak diizinkan</b>',
            '',
            'Chat ini belum terdaftar untuk mengelola pelanggan.',
            `Berikan Chat ID ini ke admin: <code>${escapeHtml(chatId)}</code>`,
        ].join('\n'),
    };
}

/** New self-registration alert with inline Approve / Reject / Detail buttons. */
export function buildRegistrationAlert(reg) {
    const lines = [
        '🆕 <b>Pendaftaran Pelanggan Baru</b>',
        '━━━━━━━━━━━━━━━━━━━━',
        `👤 Username: <b>${escapeHtml(reg.username)}</b>`,
        `📱 HP: ${escapeHtml(reg.phone || '-')}`,
    ];
    if (reg.email) {
        lines.push(`📧 Email: ${escapeHtml(reg.email)}`);
    }
    lines.push(
        `📦 Paket: ${escapeHtml(planLabel(reg.plan))}`,
        '━━━━━━━━━━━━━━━━━━━━',
        '<i>Setujui untuk mengaktifkan akun (masa paket mulai berjalan saat disetujui).</i>',
    );
    return {
        text: lines.join('\n'),
        reply_markup: inlineKeyboard([
            [btn('✅ Setujui', ACTIONS.APPROVE, reg.id), btn('⛔ Tolak', ACTIONS.REJECT, reg.id)],
            [btn('👁 Detail', ACTIONS.CUSTOMER, reg.id)],
        ]),
    };
}

export function buildPendingHeader(count) {
    if (!count) {
        return { text: '✅ Tidak ada pendaftaran yang menunggu persetujuan.' };
    }
    return {
        text: `⏳ <b>${count} pendaftaran</b> menunggu persetujuan:`,
    };
}

/** One compact card per pending registration, each with its own action buttons. */
export function buildPendingItem(reg) {
    const lines = [
        `👤 <b>${escapeHtml(reg.username)}</b> · id <code>${escapeHtml(reg.id)}</code>`,
        `📱 ${escapeHtml(reg.phone || '-')}${reg.email ? ` · 📧 ${escapeHtml(reg.email)}` : ''}`,
        `📦 ${escapeHtml(planLabel(reg.plan))}`,
    ];
    return {
        text: lines.join('\n'),
        reply_markup: inlineKeyboard([
            [btn('✅ Setujui', ACTIONS.APPROVE, reg.id), btn('⛔ Tolak', ACTIONS.REJECT, reg.id)],
        ]),
    };
}

export function buildCustomerDetail(detail, { writeEnabled = {} } = {}) {
    const lines = [
        `👤 <b>${escapeHtml(detail.username)}</b> · id <code>${escapeHtml(detail.id)}</code>`,
        `Status: ${accountStatusLabel(detail.account_status)}`,
        `📱 ${escapeHtml(detail.phone || '-')}${detail.email ? ` · 📧 ${escapeHtml(detail.email)}` : ''}`,
        `📦 Paket: ${escapeHtml(planLabel(detail.plan))}`,
        '━━━━━━━━━━━━━━━━━━━━',
        `💰 Saldo: <b>${formatRupiah(detail.balance)}</b>`,
        `📉 Biaya harian: ${formatRupiah(detail.daily_cost)}`,
    ];
    if (detail.estimated_days_left != null) {
        const warn = detail.low_balance ? ' ⚠️' : '';
        lines.push(`⏳ Estimasi saldo cukup: ~${detail.estimated_days_left} hari${warn}`);
    }

    const subs = detail.subscriptions || [];
    lines.push('━━━━━━━━━━━━━━━━━━━━', `📹 Kamera (${subs.length}):`);
    if (subs.length === 0) {
        lines.push('<i>Belum ada kamera berlangganan.</i>');
    } else {
        for (const sub of subs.slice(0, 12)) {
            const mark = sub.status === 'active' ? '🟢' : sub.status === 'suspended' ? '🔴' : '⚪';
            lines.push(`${mark} ${escapeHtml(sub.camera_name)} — ${formatRupiah(sub.monthly_price)}/bln`);
        }
        if (subs.length > 12) {
            lines.push(`…dan ${subs.length - 12} kamera lainnya`);
        }
    }

    const hasActive = subs.some((s) => s.status === 'active');
    const hasSuspended = subs.some((s) => s.status === 'suspended');
    const rows = [];
    if (detail.account_status === 'pending') {
        rows.push([btn('✅ Setujui', ACTIONS.APPROVE, detail.id), btn('⛔ Tolak', ACTIONS.REJECT, detail.id)]);
    }
    if (writeEnabled.topup !== false) {
        rows.push([btn('💰 Top-up saldo', ACTIONS.TOPUP_AMOUNTS, detail.id)]);
    }
    if (writeEnabled.suspendResume !== false) {
        const serviceRow = [];
        if (hasActive) {
            serviceRow.push(btn('⏸ Suspend', ACTIONS.SUSPEND_CONFIRM, detail.id));
        }
        if (hasSuspended) {
            serviceRow.push(btn('▶️ Aktifkan', ACTIONS.RESUME_EXEC, detail.id));
        }
        if (serviceRow.length) {
            rows.push(serviceRow);
        }
    }
    if (writeEnabled.changePlan !== false) {
        rows.push([btn('📦 Ubah paket', ACTIONS.PLAN_OPTIONS, detail.id)]);
    }

    return { text: lines.join('\n'), reply_markup: inlineKeyboard(rows) };
}

export function buildCustomersPage({ customers, page, pageCount, total, query }) {
    const header = query
        ? `🔎 Hasil pencarian "<b>${escapeHtml(query)}</b>" (${total})`
        : `👥 <b>Pelanggan</b> (${total})`;
    const lines = [header];
    if (customers.length === 0) {
        lines.push('', '<i>Tidak ada pelanggan yang cocok.</i>');
        return { text: lines.join('\n') };
    }

    lines.push('');
    const rows = [];
    for (const c of customers) {
        const statusMark = c.account_status === 'pending'
            ? '⏳'
            : c.account_status === 'rejected'
                ? '⛔'
                : (c.suspended_subscriptions > 0 ? '🔴' : '🟢');
        lines.push(
            `${statusMark} <b>${escapeHtml(c.username)}</b> · id <code>${escapeHtml(c.id)}</code>`
            + ` · ${formatRupiah(c.balance)} · 📹 ${c.camera_count || 0}`,
        );
        rows.push([btn(`👁 ${c.username}`.slice(0, 60), ACTIONS.CUSTOMER, c.id)]);
    }

    const nav = [];
    if (page > 0) {
        nav.push(btn('⬅️ Sebelumnya', ACTIONS.CUSTOMERS_PAGE, page - 1));
    }
    if (page < pageCount - 1) {
        nav.push(btn('Berikutnya ➡️', ACTIONS.CUSTOMERS_PAGE, page + 1));
    }
    if (nav.length) {
        rows.push(nav);
    }
    lines.push('', `Halaman ${page + 1} / ${pageCount}`);

    return { text: lines.join('\n'), reply_markup: inlineKeyboard(rows) };
}

export function buildStatsMessage(stats) {
    return {
        text: [
            '📊 <b>Ringkasan RAF NET</b>',
            '━━━━━━━━━━━━━━━━━━━━',
            '<b>Pelanggan</b>',
            `• Total: ${stats.customersTotal}`,
            `• Menunggu persetujuan: ${stats.pending}`,
            `• Aktif: ${stats.approved} · Ditolak: ${stats.rejected}`,
            '',
            '<b>Langganan kamera</b>',
            `• Aktif: ${stats.subsActive} · Disuspend: ${stats.subsSuspended}`,
            `• Pelanggan dengan kamera tersuspend: ${stats.customersWithSuspended}`,
            '',
            '<b>Saldo</b>',
            `• Total saldo pelanggan: ${formatRupiah(stats.walletTotal)}`,
            `• Saldo menipis (&lt;3 hari): ${stats.lowBalanceCount}`,
            '━━━━━━━━━━━━━━━━━━━━',
            `<i>${escapeHtml(stats.generatedAt)}</i>`,
        ].join('\n'),
    };
}

export function buildTopupAmounts(detail) {
    const rows = TOPUP_PRESETS.map((amt) => [btn(`+ ${formatRupiah(amt)}`, ACTIONS.TOPUP_CONFIRM, detail.id, amt)]);
    rows.push([btn('⬅️ Kembali', ACTIONS.BACK, detail.id), btn('Batal', ACTIONS.DISMISS)]);
    return {
        text: [
            `💰 <b>Top-up saldo</b> — ${escapeHtml(detail.username)}`,
            `Saldo sekarang: ${formatRupiah(detail.balance)}`,
            '',
            'Pilih nominal, atau ketik <code>/topup &lt;id&gt; &lt;jumlah&gt;</code> untuk nominal bebas.',
        ].join('\n'),
        reply_markup: inlineKeyboard(rows),
    };
}

export function buildTopupConfirm({ customer, amount }) {
    return {
        text: [
            '💰 <b>Konfirmasi Top-up</b>',
            '━━━━━━━━━━━━━━━━━━━━',
            `Pelanggan: <b>${escapeHtml(customer.username)}</b> (id ${escapeHtml(customer.id)})`,
            `Saldo sekarang: ${formatRupiah(customer.balance)}`,
            `Tambah: <b>${formatRupiah(amount)}</b>`,
            `Saldo setelah: ${formatRupiah(Number(customer.balance) + Number(amount))}`,
        ].join('\n'),
        reply_markup: inlineKeyboard([
            [btn(`✅ Ya, tambah ${formatRupiah(amount)}`, ACTIONS.TOPUP_EXEC, customer.id, amount)],
            [btn('Batal', ACTIONS.BACK, customer.id)],
        ]),
    };
}

export function buildSuspendConfirm({ customer }) {
    return {
        text: [
            '⏸ <b>Konfirmasi Suspend Layanan</b>',
            '━━━━━━━━━━━━━━━━━━━━',
            `Pelanggan: <b>${escapeHtml(customer.username)}</b> (id ${escapeHtml(customer.id)})`,
            `Kamera aktif yang akan dihentikan: <b>${customer.activeCount}</b>`,
            '',
            '<i>Stream pelanggan akan berhenti. Bisa diaktifkan lagi kapan saja.</i>',
        ].join('\n'),
        reply_markup: inlineKeyboard([
            [btn('⏸ Ya, suspend', ACTIONS.SUSPEND_EXEC, customer.id)],
            [btn('Batal', ACTIONS.BACK, customer.id)],
        ]),
    };
}

export function buildPlanOptions({ customer, plans, currentPlanId }) {
    const rows = plans.map((plan) => {
        const current = plan.id === currentPlanId ? ' ✓' : '';
        const price = plan.is_trial ? 'trial' : `${formatRupiah(plan.price_per_camera)}/kamera`;
        return [btn(`${plan.name} — ${price}${current}`.slice(0, 60), ACTIONS.PLAN_SET, customer.id, plan.id)];
    });
    rows.push([btn('⬅️ Kembali', ACTIONS.BACK, customer.id), btn('Batal', ACTIONS.DISMISS)]);
    return {
        text: [
            `📦 <b>Ubah paket</b> — ${escapeHtml(customer.username)}`,
            `Paket sekarang: ${escapeHtml(planLabel(customer.plan))}`,
            '',
            'Pilih paket baru. Semua langganan pelanggan akan di-reprice & ditagih ulang hari ini dengan harga baru.',
        ].join('\n'),
        reply_markup: inlineKeyboard(rows),
    };
}

/** Plain result text used to replace a card after an action resolves. */
export function buildResult(emoji, title, detailLines = []) {
    return { text: [`${emoji} <b>${title}</b>`, ...detailLines].join('\n') };
}
