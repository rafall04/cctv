/**
 * Purpose: Interactive Telegram bot for customer management — receives updates via long
 *          polling and handles /commands + inline-button callbacks for approving new
 *          registrations, browsing customers, top-up, suspend/resume, and plan changes.
 *          Complements the outbound-only telegramService (alerts) with a two-way channel.
 * Caller: server.js (start/stop lifecycle); authController (notifyNewRegistration).
 * Deps: telegramService (token + low-level API + command allow-list), billingPlanService,
 *       billingService, walletService, connectionPool, securityAuditLogger, timezoneService,
 *       telegramBotPresenter (pure formatting/encoding).
 * MainFuncs: start, stop, notifyNewRegistration.
 * SideEffects: Long-polls Telegram getUpdates; sends/edits messages; mutates billing state
 *              through the same audited services the admin web UI uses.
 */

import { query, queryOne } from '../database/connectionPool.js';
import billingPlanService from './billingPlanService.js';
import billingService, { dailyCostOf } from './billingService.js';
import walletService from './walletService.js';
import { logAdminAction } from './securityAuditLogger.js';
import { formatDateTime } from './timezoneService.js';
import { callTelegramApi, getBotRuntimeConfig, isCommandChat } from './telegramService.js';
import * as presenter from './telegramBotPresenter.js';

const LONG_POLL_SECONDS = 30;
const IDLE_RECHECK_MS = 15000;        // no token yet → recheck so an admin can enable the bot without a restart
const TRANSPORT_BACKOFF_MS = 5000;    // network hiccup
const API_ERROR_BACKOFF_MS = 10000;   // Telegram returned ok:false (e.g. 409 conflict with another poller/webhook)
const ALLOWED_UPDATES = ['message', 'callback_query'];
const PAGE_SIZE = 6;
const MAX_TOPUP = 10000000;           // Rp10jt fat-finger ceiling for a single bot top-up

// All write actions the operator opted into (top-up, suspend/resume, plan change).
// Centralized so the presenter's buttons/help and the routers stay in lockstep.
const WRITE_ENABLED = { topup: true, suspendResume: true, changePlan: true };

class TelegramBotService {
    constructor() {
        this.isRunning = false;
        this.offset = undefined;
        this.abortController = null;
        this.loopPromise = null;
        this.tokenSeen = false;
        this.startupLogged = false;
    }

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------

    start() {
        if (this.isRunning) {
            console.log('[TelegramBot] Already running');
            return;
        }
        this.isRunning = true;
        this.abortController = new AbortController();
        this.tokenSeen = false;
        this.startupLogged = false;
        this.loopPromise = this.runLoop().catch((error) => {
            console.error('[TelegramBot] Fatal loop error:', error?.message);
        });
        console.log('[TelegramBot] Service started (long-polling)');
    }

    stop() {
        if (!this.isRunning) {
            return;
        }
        this.isRunning = false;
        this.abortController?.abort();
        console.log('[TelegramBot] Service stopped');
    }

    sleep(ms) {
        return new Promise((resolve) => {
            if (!this.isRunning) {
                resolve();
                return;
            }
            const signal = this.abortController?.signal;
            const timer = setTimeout(() => {
                signal?.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
            const onAbort = () => {
                clearTimeout(timer);
                resolve();
            };
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }

    async runLoop() {
        while (this.isRunning) {
            try {
                const { hasToken } = getBotRuntimeConfig();
                if (!hasToken) {
                    this.tokenSeen = false;
                    await this.sleep(IDLE_RECHECK_MS);
                    continue;
                }
                if (!this.tokenSeen) {
                    // Token just became available (boot, or admin set it live). Verify the
                    // token + surface the #1 silent-failure cause (a stale webhook blocks
                    // getUpdates), then discard backlog so stale taps aren't replayed.
                    await this.logBotHealth();
                    this.offset = undefined;
                    await this.drainBacklog();
                    this.tokenSeen = true;
                    if (!this.startupLogged) {
                        console.log('[TelegramBot] Listening for commands & approvals');
                        this.startupLogged = true;
                    }
                }

                const data = await callTelegramApi('getUpdates', {
                    offset: this.offset,
                    timeout: LONG_POLL_SECONDS,
                    allowed_updates: ALLOWED_UPDATES,
                }, { timeoutMs: (LONG_POLL_SECONDS + 5) * 1000, signal: this.abortController.signal });

                if (!this.isRunning) {
                    break;
                }
                if (!data) {
                    await this.sleep(TRANSPORT_BACKOFF_MS);
                    continue;
                }
                if (!data.ok) {
                    // 409 = a webhook OR another poller owns this token's update stream.
                    // Either way getUpdates returns nothing until that is resolved.
                    if (/conflict/i.test(data.description || '')) {
                        console.error('[TelegramBot] getUpdates 409 CONFLICT — another process is polling this bot token, or a webhook is set. Run ONE server per token and remove any webhook (deleteWebhook).');
                    } else {
                        console.error('[TelegramBot] getUpdates failed:', data.description);
                    }
                    await this.sleep(API_ERROR_BACKOFF_MS);
                    continue;
                }

                for (const update of data.result || []) {
                    this.offset = update.update_id + 1;
                    if (!this.isRunning) {
                        break;
                    }
                    await this.handleUpdate(update).catch((error) => {
                        console.error('[TelegramBot] Update handling error:', error?.message);
                    });
                }
            } catch (error) {
                if (this.isRunning) {
                    console.error('[TelegramBot] Loop error:', error?.message);
                    await this.sleep(TRANSPORT_BACKOFF_MS);
                }
            }
        }
    }

    async drainBacklog() {
        let discarded = 0;
        for (let i = 0; i < 20 && this.isRunning; i += 1) {
            const data = await callTelegramApi('getUpdates', {
                offset: this.offset,
                timeout: 0,
                allowed_updates: ALLOWED_UPDATES,
            }, { timeoutMs: 15000, signal: this.abortController?.signal });
            if (!data || !data.ok || !Array.isArray(data.result) || data.result.length === 0) {
                break;
            }
            for (const update of data.result) {
                this.offset = update.update_id + 1;
            }
            discarded += data.result.length;
        }
        if (discarded > 0) {
            console.log(`[TelegramBot] Discarded ${discarded} backlog update(s) on start`);
        }
    }

    /**
     * One-shot health probe logged when the bot goes live. Confirms the token works
     * (getMe), warns loudly about a webhook that would silently block long-polling, and
     * prints the resolved command allow-list so an operator can see who may control it.
     */
    async logBotHealth() {
        const me = await callTelegramApi('getMe', {});
        if (me?.ok) {
            console.log(`[TelegramBot] Connected as @${me.result?.username} (id ${me.result?.id})`);
        } else {
            console.warn('[TelegramBot] getMe failed — bot token may be invalid:', me?.description || 'no response');
        }

        const hook = await callTelegramApi('getWebhookInfo', {});
        if (hook?.ok && hook.result?.url) {
            console.warn(`[TelegramBot] ⚠️ A webhook is set on this bot (${hook.result.url}). Long-polling getUpdates will return 409 until it is removed — call deleteWebhook on this bot token.`);
        }

        const { commandChatIds } = getBotRuntimeConfig();
        console.log(
            `[TelegramBot] Authorized command chats: ${commandChatIds.length
                ? commandChatIds.join(', ')
                : '(NONE — approvals/commands are disabled. Set "Chat ID Admin Bot" or a monitoring chat in Settings → Telegram.)'}`
        );
    }

    // ---------------------------------------------------------------------
    // Telegram API helpers
    // ---------------------------------------------------------------------

    async sendMessage(chatId, { text, reply_markup } = {}) {
        const payload = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
        if (reply_markup) {
            payload.reply_markup = reply_markup;
        }
        return callTelegramApi('sendMessage', payload);
    }

    async editMessage(chatId, messageId, { text, reply_markup } = {}) {
        const data = await callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            // Always pass markup so a resolved card clears its (now-stale) buttons.
            reply_markup: reply_markup || { inline_keyboard: [] },
        });
        // "message is not modified" is harmless; any other failure → post a fresh message
        // so the operator still sees the result rather than silently losing it.
        if (data && !data.ok && !/not modified/i.test(data.description || '')) {
            await this.sendMessage(chatId, { text, reply_markup });
        }
    }

    async answerCallback(callbackId, text = '', { alert = false } = {}) {
        return callTelegramApi('answerCallbackQuery', {
            callback_query_id: callbackId,
            text: String(text).slice(0, 200),
            show_alert: alert,
        });
    }

    actorOf(from) {
        if (!from) {
            return { id: 'unknown', name: 'unknown' };
        }
        const name = from.username ? `@${from.username}` : (from.first_name || `id${from.id}`);
        return { id: from.id, name };
    }

    botRequest(actor) {
        // Synthetic request so the shared audited services attribute bot-driven
        // changes to the operator who tapped, with a recognizable source.
        return {
            ip: 'telegram-bot',
            headers: { 'user-agent': `telegram-bot/${actor?.id ?? 'unknown'}` },
            url: '/telegram-bot',
            user: { id: null, username: `telegram:${actor?.name ?? actor?.id ?? 'unknown'}` },
        };
    }

    now() {
        return formatDateTime(new Date());
    }

    // ---------------------------------------------------------------------
    // Data helpers (read models for the presenter)
    // ---------------------------------------------------------------------

    resolveCustomerId(arg) {
        if (arg == null) {
            return null;
        }
        const raw = String(arg).trim().replace(/^@/, '');
        if (/^\d+$/.test(raw)) {
            return Number(raw);
        }
        const found = queryOne(
            "SELECT id FROM users WHERE role = 'customer' AND username = ?",
            [raw]
        );
        return found ? found.id : null;
    }

    parseAmount(value) {
        const digits = String(value == null ? '' : value).replace(/[^\d]/g, '');
        return digits ? Number(digits) : NaN;
    }

    getRegistrationInfo(userId) {
        const user = queryOne(
            "SELECT id, username, phone, email, plan_id FROM users WHERE id = ? AND role = 'customer'",
            [userId]
        );
        if (!user) {
            return null;
        }
        const plan = user.plan_id ? billingPlanService.getPlanById(user.plan_id) : null;
        return {
            id: user.id,
            username: user.username,
            phone: user.phone,
            email: user.email,
            plan: plan ? { name: plan.name, is_trial: plan.is_trial === 1 } : null,
        };
    }

    getCustomerDetail(userId) {
        const user = queryOne(
            "SELECT id, username, phone, email, account_status, plan_id FROM users WHERE id = ? AND role = 'customer'",
            [userId]
        );
        if (!user) {
            return null;
        }
        const plan = user.plan_id ? billingPlanService.getPlanById(user.plan_id) : null;
        const summary = billingService.getCustomerBillingSummary(userId);
        return {
            id: user.id,
            username: user.username,
            phone: user.phone,
            email: user.email,
            account_status: user.account_status,
            plan_id: user.plan_id,
            plan: plan
                ? { name: plan.name, key: plan.key, is_trial: plan.is_trial === 1, max_cameras: plan.max_cameras }
                : null,
            balance: summary.balance,
            daily_cost: summary.daily_cost,
            estimated_days_left: summary.estimated_days_left,
            low_balance: summary.low_balance,
            subscriptions: (summary.subscriptions || []).map((s) => ({
                id: s.id,
                camera_name: s.camera_name,
                status: s.status,
                monthly_price: s.monthly_price,
            })),
        };
    }

    listCustomersPage(searchText, page) {
        const search = String(searchText || '').trim();
        const filters = ["u.role = 'customer'"];
        const params = [];
        if (search) {
            filters.push('(u.username LIKE ? OR u.phone LIKE ?)');
            const like = `%${search}%`;
            params.push(like, like);
        }
        const where = `WHERE ${filters.join(' AND ')}`;
        const total = queryOne(`SELECT COUNT(*) AS n FROM users u ${where}`, params).n;
        const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
        const safePage = Math.min(Math.max(0, Number(page) || 0), pageCount - 1);
        const customers = query(
            `SELECT u.id, u.username, u.account_status,
                    COALESCE(w.balance, 0) AS balance,
                    (SELECT COUNT(*) FROM cameras c WHERE c.owner_user_id = u.id) AS camera_count,
                    (SELECT COUNT(*) FROM camera_subscriptions cs
                      WHERE cs.user_id = u.id AND cs.status = 'suspended') AS suspended_subscriptions
             FROM users u
             LEFT JOIN wallets w ON w.user_id = u.id
             ${where}
             ORDER BY u.id ASC
             LIMIT ? OFFSET ?`,
            [...params, PAGE_SIZE, safePage * PAGE_SIZE]
        );
        return { customers, page: safePage, pageCount, total, query: search };
    }

    getStats() {
        const statusRows = query(
            "SELECT account_status, COUNT(*) AS n FROM users WHERE role = 'customer' GROUP BY account_status"
        );
        const byStatus = Object.fromEntries(statusRows.map((r) => [r.account_status, r.n]));
        const subRows = query('SELECT status, COUNT(*) AS n FROM camera_subscriptions GROUP BY status');
        const bySub = Object.fromEntries(subRows.map((r) => [r.status, r.n]));
        const customersWithSuspended = queryOne(
            "SELECT COUNT(DISTINCT user_id) AS n FROM camera_subscriptions WHERE status = 'suspended'"
        ).n;
        const walletTotal = queryOne(
            "SELECT COALESCE(SUM(w.balance), 0) AS total FROM wallets w JOIN users u ON u.id = w.user_id WHERE u.role = 'customer'"
        ).total;
        const balanceRows = query(
            `SELECT COALESCE(w.balance, 0) AS balance, COALESCE(SUM(cs.monthly_price), 0) AS monthly
             FROM users u
             LEFT JOIN wallets w ON w.user_id = u.id
             LEFT JOIN camera_subscriptions cs ON cs.user_id = u.id AND cs.status = 'active'
             WHERE u.role = 'customer'
             GROUP BY u.id`
        );
        const lowBalanceCount = balanceRows.filter(
            (r) => r.monthly > 0 && r.balance < dailyCostOf(r.monthly) * 3
        ).length;

        const customersTotal = statusRows.reduce((sum, r) => sum + r.n, 0);
        return {
            customersTotal,
            pending: byStatus.pending || 0,
            approved: byStatus.approved || 0,
            rejected: byStatus.rejected || 0,
            subsActive: bySub.active || 0,
            subsSuspended: bySub.suspended || 0,
            customersWithSuspended,
            walletTotal,
            lowBalanceCount,
            generatedAt: this.now(),
        };
    }

    // ---------------------------------------------------------------------
    // Update routing
    // ---------------------------------------------------------------------

    async handleUpdate(update) {
        if (update.callback_query) {
            return this.handleCallback(update.callback_query);
        }
        if (update.message) {
            return this.handleMessage(update.message);
        }
        return undefined;
    }

    async handleMessage(message) {
        const text = message.text || message.caption || '';
        const parsed = presenter.parseCommand(text);
        if (!parsed) {
            return undefined;
        }
        const chatId = message.chat?.id;
        const actor = this.actorOf(message.from);
        const authorized = isCommandChat(chatId);
        console.log(`[TelegramBot] /${parsed.command} from chat ${chatId} (authorized=${authorized})`);

        // Pre-auth commands so an operator can discover their Chat ID and verify setup.
        if (parsed.command === 'start' || parsed.command === 'help') {
            return this.sendMessage(chatId, presenter.buildHelpMessage({ authorized, chatId, writeEnabled: WRITE_ENABLED }));
        }
        if (['id', 'chatid', 'whoami'].includes(parsed.command)) {
            return this.sendMessage(chatId, { text: `Chat ID: <code>${presenter.escapeHtml(chatId)}</code>` });
        }
        if (!authorized) {
            return this.sendMessage(chatId, presenter.buildUnauthorizedNotice(chatId));
        }

        switch (parsed.command) {
            case 'pending':
            case 'persetujuan':
                return this.cmdPending(chatId);
            case 'customers':
            case 'pelanggan':
                return this.cmdCustomers(chatId, parsed.argsText);
            case 'customer':
                return this.cmdCustomer(chatId, parsed.args[0]);
            case 'stats':
            case 'statistik':
                return this.cmdStats(chatId);
            case 'topup':
                return this.cmdTopup(chatId, parsed.args);
            case 'suspend':
                return this.cmdSuspend(chatId, parsed.args[0]);
            case 'resume':
            case 'aktifkan':
                return this.cmdResume(chatId, parsed.args[0], actor);
            case 'plan':
            case 'paket':
                return this.cmdPlan(chatId, parsed.args[0]);
            default:
                return this.sendMessage(chatId, { text: 'Perintah tidak dikenali. Ketik /help untuk daftar perintah.' });
        }
    }

    async handleCallback(cq) {
        const chatId = cq.message?.chat?.id;
        const messageId = cq.message?.message_id;
        const actor = this.actorOf(cq.from);

        if (!isCommandChat(chatId)) {
            console.log(`[TelegramBot] Denied button tap from unauthorized chat ${chatId}`);
            return this.answerCallback(cq.id, '⛔ Tidak diizinkan', { alert: true });
        }
        const decoded = presenter.decodeCallback(cq.data);
        if (!decoded) {
            return this.answerCallback(cq.id, 'Tombol sudah kedaluwarsa.');
        }

        const { action, params } = decoded;
        const A = presenter.ACTIONS;
        const id = Number(params[0]);
        switch (action) {
            case A.APPROVE:
                return this.actApprove(cq, chatId, messageId, id, actor);
            case A.REJECT:
                return this.actReject(cq, chatId, messageId, id, actor);
            case A.CUSTOMER:
            case A.BACK:
                return this.actShowCustomer(cq, chatId, messageId, id);
            case A.CUSTOMERS_PAGE:
                return this.actCustomersPage(cq, chatId, messageId, id);
            case A.TOPUP_AMOUNTS:
                return this.actTopupAmounts(cq, chatId, messageId, id);
            case A.TOPUP_CONFIRM:
                return this.actTopupConfirm(cq, chatId, messageId, id, Number(params[1]));
            case A.TOPUP_EXEC:
                return this.actTopupExec(cq, chatId, messageId, id, Number(params[1]), actor);
            case A.SUSPEND_CONFIRM:
                return this.actSuspendConfirm(cq, chatId, messageId, id);
            case A.SUSPEND_EXEC:
                return this.actSuspendExec(cq, chatId, messageId, id, actor);
            case A.RESUME_EXEC:
                return this.actResumeExec(cq, chatId, messageId, id, actor);
            case A.PLAN_OPTIONS:
                return this.actPlanOptions(cq, chatId, messageId, id);
            case A.PLAN_SET:
                return this.actPlanSet(cq, chatId, messageId, id, Number(params[1]), actor);
            case A.DISMISS:
                await this.answerCallback(cq.id, 'Dibatalkan');
                return this.editMessage(chatId, messageId, presenter.buildResult('✖️', 'Dibatalkan.'));
            default:
                return this.answerCallback(cq.id, 'Aksi tidak dikenali.');
        }
    }

    // ---------------------------------------------------------------------
    // Commands
    // ---------------------------------------------------------------------

    async cmdPending(chatId) {
        const pending = billingPlanService.listPendingRegistrations();
        await this.sendMessage(chatId, presenter.buildPendingHeader(pending.length));
        const items = pending.slice(0, 10);
        for (const reg of items) {
            await this.sendMessage(chatId, presenter.buildPendingItem({
                id: reg.id,
                username: reg.username,
                phone: reg.phone,
                email: reg.email,
                plan: reg.plan_name ? { name: reg.plan_name, is_trial: reg.plan_is_trial === 1 } : null,
            }));
        }
        if (pending.length > items.length) {
            await this.sendMessage(chatId, { text: `…dan ${pending.length - items.length} lainnya. Setujui sebagian dulu lalu ketik /pending lagi.` });
        }
        return undefined;
    }

    async cmdCustomers(chatId, searchText, page = 0) {
        const data = this.listCustomersPage(searchText, page);
        return this.sendMessage(chatId, presenter.buildCustomersPage(data));
    }

    async cmdCustomer(chatId, arg) {
        const id = this.resolveCustomerId(arg);
        if (!id) {
            return this.sendMessage(chatId, { text: 'Format: <code>/customer &lt;id|username&gt;</code>' });
        }
        const detail = this.getCustomerDetail(id);
        if (!detail) {
            return this.sendMessage(chatId, { text: 'Pelanggan tidak ditemukan.' });
        }
        return this.sendMessage(chatId, presenter.buildCustomerDetail(detail, { writeEnabled: WRITE_ENABLED }));
    }

    async cmdStats(chatId) {
        return this.sendMessage(chatId, presenter.buildStatsMessage(this.getStats()));
    }

    async cmdTopup(chatId, args) {
        const id = this.resolveCustomerId(args[0]);
        const amount = this.parseAmount(args[1]);
        if (!id) {
            return this.sendMessage(chatId, { text: 'Format: <code>/topup &lt;id|username&gt; &lt;jumlah&gt;</code>\nContoh: <code>/topup 12 50000</code>' });
        }
        const detail = this.getCustomerDetail(id);
        if (!detail) {
            return this.sendMessage(chatId, { text: 'Pelanggan tidak ditemukan.' });
        }
        if (!(amount > 0)) {
            return this.sendMessage(chatId, { text: 'Jumlah tidak valid. Contoh: <code>/topup 12 50000</code>' });
        }
        if (amount > MAX_TOPUP) {
            return this.sendMessage(chatId, { text: `Jumlah melebihi batas (maks ${presenter.formatRupiah(MAX_TOPUP)}).` });
        }
        return this.sendMessage(chatId, presenter.buildTopupConfirm({ customer: detail, amount }));
    }

    async cmdSuspend(chatId, arg) {
        const id = this.resolveCustomerId(arg);
        if (!id) {
            return this.sendMessage(chatId, { text: 'Format: <code>/suspend &lt;id|username&gt;</code>' });
        }
        const detail = this.getCustomerDetail(id);
        if (!detail) {
            return this.sendMessage(chatId, { text: 'Pelanggan tidak ditemukan.' });
        }
        const activeCount = detail.subscriptions.filter((s) => s.status === 'active').length;
        if (!activeCount) {
            return this.sendMessage(chatId, { text: 'Tidak ada layanan aktif untuk disuspend.' });
        }
        return this.sendMessage(chatId, presenter.buildSuspendConfirm({
            customer: { id: detail.id, username: detail.username, activeCount },
        }));
    }

    async cmdResume(chatId, arg, actor) {
        const id = this.resolveCustomerId(arg);
        if (!id) {
            return this.sendMessage(chatId, { text: 'Format: <code>/resume &lt;id|username&gt;</code>' });
        }
        const detail = this.getCustomerDetail(id);
        if (!detail) {
            return this.sendMessage(chatId, { text: 'Pelanggan tidak ditemukan.' });
        }
        const result = this.executeResume(id, actor);
        return this.sendMessage(chatId, result);
    }

    async cmdPlan(chatId, arg) {
        const id = this.resolveCustomerId(arg);
        if (!id) {
            return this.sendMessage(chatId, { text: 'Format: <code>/plan &lt;id|username&gt;</code>' });
        }
        const detail = this.getCustomerDetail(id);
        if (!detail) {
            return this.sendMessage(chatId, { text: 'Pelanggan tidak ditemukan.' });
        }
        const plans = billingPlanService.listPlans({ activeOnly: true });
        return this.sendMessage(chatId, presenter.buildPlanOptions({
            customer: detail,
            plans,
            currentPlanId: detail.plan_id,
        }));
    }

    // ---------------------------------------------------------------------
    // Callback actions
    // ---------------------------------------------------------------------

    async actApprove(cq, chatId, messageId, userId, actor) {
        try {
            const result = billingPlanService.approveCustomer(userId, this.botRequest(actor));
            await this.answerCallback(cq.id, '✅ Disetujui');
            await this.editMessage(chatId, messageId, presenter.buildResult('✅', 'Pendaftaran disetujui', [
                `👤 ${presenter.escapeHtml(result.username)} (id ${userId})`,
                `oleh ${presenter.escapeHtml(actor.name)} · ${this.now()}`,
            ]));
        } catch (error) {
            await this.answerCallback(cq.id, error.message || 'Gagal menyetujui', { alert: true });
        }
        return undefined;
    }

    async actReject(cq, chatId, messageId, userId, actor) {
        try {
            const result = billingPlanService.rejectCustomer(userId, this.botRequest(actor));
            await this.answerCallback(cq.id, '⛔ Ditolak');
            await this.editMessage(chatId, messageId, presenter.buildResult('⛔', 'Pendaftaran ditolak', [
                `👤 ${presenter.escapeHtml(result.username)} (id ${userId})`,
                `oleh ${presenter.escapeHtml(actor.name)} · ${this.now()}`,
            ]));
        } catch (error) {
            await this.answerCallback(cq.id, error.message || 'Gagal menolak', { alert: true });
        }
        return undefined;
    }

    async actShowCustomer(cq, chatId, messageId, userId) {
        const detail = this.getCustomerDetail(userId);
        if (!detail) {
            return this.answerCallback(cq.id, 'Pelanggan tidak ditemukan.', { alert: true });
        }
        await this.answerCallback(cq.id);
        return this.editMessage(chatId, messageId, presenter.buildCustomerDetail(detail, { writeEnabled: WRITE_ENABLED }));
    }

    async actCustomersPage(cq, chatId, messageId, page) {
        const data = this.listCustomersPage('', page);
        await this.answerCallback(cq.id);
        return this.editMessage(chatId, messageId, presenter.buildCustomersPage(data));
    }

    async actTopupAmounts(cq, chatId, messageId, userId) {
        const detail = this.getCustomerDetail(userId);
        if (!detail) {
            return this.answerCallback(cq.id, 'Pelanggan tidak ditemukan.', { alert: true });
        }
        await this.answerCallback(cq.id);
        return this.editMessage(chatId, messageId, presenter.buildTopupAmounts(detail));
    }

    async actTopupConfirm(cq, chatId, messageId, userId, amount) {
        const detail = this.getCustomerDetail(userId);
        if (!detail) {
            return this.answerCallback(cq.id, 'Pelanggan tidak ditemukan.', { alert: true });
        }
        if (!(amount > 0) || amount > MAX_TOPUP) {
            return this.answerCallback(cq.id, 'Nominal tidak valid.', { alert: true });
        }
        await this.answerCallback(cq.id);
        return this.editMessage(chatId, messageId, presenter.buildTopupConfirm({ customer: detail, amount }));
    }

    async actTopupExec(cq, chatId, messageId, userId, amount, actor) {
        const detail = this.getCustomerDetail(userId);
        if (!detail) {
            return this.answerCallback(cq.id, 'Pelanggan tidak ditemukan.', { alert: true });
        }
        if (!(amount > 0) || amount > MAX_TOPUP) {
            return this.answerCallback(cq.id, 'Nominal tidak valid.', { alert: true });
        }
        try {
            const credit = walletService.credit({
                userId,
                amount,
                type: 'topup',
                reference: `manual-telegram:${actor.id}:${Date.now()}`,
                note: `Top-up via Telegram oleh ${actor.name}`,
            });
            const resume = billingService.tryResumeForUser(userId);
            logAdminAction({
                action: 'billing_manual_topup',
                customerId: userId,
                amount,
                via: 'telegram',
                adminUsername: `telegram:${actor.name}`,
                resumedCameraIds: resume.resumedCameraIds,
            }, this.botRequest(actor));

            await this.answerCallback(cq.id, '✅ Saldo ditambahkan');
            const lines = [
                `👤 ${presenter.escapeHtml(detail.username)} (id ${userId})`,
                `Ditambah: ${presenter.formatRupiah(amount)}`,
                `Saldo sekarang: ${presenter.formatRupiah(credit.balance_after)}`,
            ];
            if (resume.resumedCameraIds.length > 0) {
                lines.push(`▶️ ${resume.resumedCameraIds.length} kamera diaktifkan kembali`);
            }
            lines.push(`oleh ${presenter.escapeHtml(actor.name)} · ${this.now()}`);
            await this.editMessage(chatId, messageId, presenter.buildResult('💰', 'Top-up berhasil', lines));
        } catch (error) {
            await this.answerCallback(cq.id, error.message || 'Top-up gagal', { alert: true });
        }
        return undefined;
    }

    async actSuspendConfirm(cq, chatId, messageId, userId) {
        const detail = this.getCustomerDetail(userId);
        if (!detail) {
            return this.answerCallback(cq.id, 'Pelanggan tidak ditemukan.', { alert: true });
        }
        const activeCount = detail.subscriptions.filter((s) => s.status === 'active').length;
        if (!activeCount) {
            return this.answerCallback(cq.id, 'Tidak ada layanan aktif.', { alert: true });
        }
        await this.answerCallback(cq.id);
        return this.editMessage(chatId, messageId, presenter.buildSuspendConfirm({
            customer: { id: detail.id, username: detail.username, activeCount },
        }));
    }

    async actSuspendExec(cq, chatId, messageId, userId, actor) {
        const detail = this.getCustomerDetail(userId);
        if (!detail) {
            return this.answerCallback(cq.id, 'Pelanggan tidak ditemukan.', { alert: true });
        }
        const activeSubs = detail.subscriptions.filter((s) => s.status === 'active');
        let suspended = 0;
        for (const sub of activeSubs) {
            try {
                billingService.updateSubscription(sub.id, { status: 'suspended' }, this.botRequest(actor));
                suspended += 1;
            } catch (error) {
                console.error('[TelegramBot] Suspend failed for subscription', sub.id, error?.message);
            }
        }
        logAdminAction({
            action: 'billing_suspend_via_telegram',
            customerId: userId,
            suspendedCount: suspended,
            adminUsername: `telegram:${actor.name}`,
        }, this.botRequest(actor));
        await this.answerCallback(cq.id, `⏸ ${suspended} kamera disuspend`);
        return this.editMessage(chatId, messageId, presenter.buildResult('⏸', 'Layanan disuspend', [
            `👤 ${presenter.escapeHtml(detail.username)} (id ${userId})`,
            `Kamera disuspend: ${suspended}`,
            `oleh ${presenter.escapeHtml(actor.name)} · ${this.now()}`,
        ]));
    }

    executeResume(userId, actor) {
        const resume = billingService.tryResumeForUser(userId);
        logAdminAction({
            action: 'billing_resume_via_telegram',
            customerId: userId,
            resumedCameraIds: resume.resumedCameraIds,
            adminUsername: `telegram:${actor.name}`,
        }, this.botRequest(actor));
        if (resume.resumedCameraIds.length === 0) {
            return presenter.buildResult('ℹ️', 'Tidak ada kamera yang bisa diaktifkan', [
                'Mungkin saldo belum cukup atau tidak ada kamera tersuspend.',
            ]);
        }
        return presenter.buildResult('▶️', 'Layanan diaktifkan', [
            `${resume.resumedCameraIds.length} kamera kembali aktif`,
            `oleh ${presenter.escapeHtml(actor.name)} · ${this.now()}`,
        ]);
    }

    async actResumeExec(cq, chatId, messageId, userId, actor) {
        const detail = this.getCustomerDetail(userId);
        if (!detail) {
            return this.answerCallback(cq.id, 'Pelanggan tidak ditemukan.', { alert: true });
        }
        const result = this.executeResume(userId, actor);
        await this.answerCallback(cq.id, 'Selesai');
        return this.editMessage(chatId, messageId, result);
    }

    async actPlanOptions(cq, chatId, messageId, userId) {
        const detail = this.getCustomerDetail(userId);
        if (!detail) {
            return this.answerCallback(cq.id, 'Pelanggan tidak ditemukan.', { alert: true });
        }
        const plans = billingPlanService.listPlans({ activeOnly: true });
        await this.answerCallback(cq.id);
        return this.editMessage(chatId, messageId, presenter.buildPlanOptions({
            customer: detail,
            plans,
            currentPlanId: detail.plan_id,
        }));
    }

    async actPlanSet(cq, chatId, messageId, userId, planId, actor) {
        try {
            billingPlanService.changeUserPlan(userId, planId, { byAdmin: true, request: this.botRequest(actor) });
            await this.answerCallback(cq.id, '✅ Paket diubah');
            const detail = this.getCustomerDetail(userId);
            return this.editMessage(chatId, messageId, presenter.buildCustomerDetail(detail, { writeEnabled: WRITE_ENABLED }));
        } catch (error) {
            await this.answerCallback(cq.id, error.message || 'Gagal mengubah paket', { alert: true });
        }
        return undefined;
    }

    // ---------------------------------------------------------------------
    // Outbound hook (called by authController on a new self-registration)
    // ---------------------------------------------------------------------

    async notifyNewRegistration(userId) {
        try {
            const { hasToken, commandChatIds } = getBotRuntimeConfig();
            if (!hasToken || commandChatIds.length === 0) {
                return;
            }
            const reg = this.getRegistrationInfo(userId);
            if (!reg) {
                return;
            }
            const message = presenter.buildRegistrationAlert(reg);
            for (const chatId of commandChatIds) {
                await this.sendMessage(chatId, message);
            }
        } catch (error) {
            console.error('[TelegramBot] notifyNewRegistration failed:', error?.message);
        }
    }
}

export default new TelegramBotService();
