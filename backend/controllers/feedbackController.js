import { query, queryOne, execute } from '../database/database.js';
import { sendFeedbackNotification } from '../services/telegramService.js';

/**
 * Create new feedback (public endpoint)
 */
export async function createFeedback(request, reply) {
    try {
        const { name, email, message } = request.body;

        if (!message || message.trim().length < 10) {
            return reply.code(400).send({
                success: false,
                message: 'Pesan minimal 10 karakter',
            });
        }

        if (message.length > 1000) {
            return reply.code(400).send({
                success: false,
                message: 'Pesan maksimal 1000 karakter',
            });
        }

        const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';

        const result = execute(
            `INSERT INTO feedbacks (name, email, message, ip_address) VALUES (?, ?, ?, ?)`,
            [name?.trim() || null, email?.trim() || null, message.trim(), ip]
        );

        const feedback = queryOne('SELECT * FROM feedbacks WHERE id = ?', [result.lastInsertRowid]);

        // Send to Telegram (async, don't wait)
        sendFeedbackNotification(feedback).catch(err => {
            console.error('[Feedback] Failed to send Telegram notification:', err);
        });

        return reply.code(201).send({
            success: true,
            message: 'Terima kasih atas kritik dan saran Anda',
            data: { id: feedback.id },
        });
    } catch (error) {
        console.error('Create feedback error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal menyimpan feedback',
        });
    }
}

/**
 * Get all feedbacks (admin only)
 */
export async function getAllFeedbacks(request, reply) {
    try {
        const { page = 1, limit = 20, status } = request.query;
        const offset = (page - 1) * limit;

        let sql = 'SELECT * FROM feedbacks';
        let countSql = 'SELECT COUNT(*) as total FROM feedbacks';
        const params = [];

        if (status) {
            sql += ' WHERE status = ?';
            countSql += ' WHERE status = ?';
            params.push(status);
        }

        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

        const feedbacks = query(sql, [...params, limit, offset]);
        const { total } = queryOne(countSql, params);

        return reply.send({
            success: true,
            data: feedbacks,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('Get feedbacks error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal mengambil data feedback',
        });
    }
}

/**
 * Update feedback status (admin only)
 */
export async function updateFeedbackStatus(request, reply) {
    try {
        const { id } = request.params;
        const { status } = request.body;

        const validStatuses = ['unread', 'read', 'resolved'];
        if (!validStatuses.includes(status)) {
            return reply.code(400).send({
                success: false,
                message: 'Status tidak valid',
            });
        }

        const existing = queryOne('SELECT id FROM feedbacks WHERE id = ?', [id]);
        if (!existing) {
            return reply.code(404).send({
                success: false,
                message: 'Feedback tidak ditemukan',
            });
        }

        execute('UPDATE feedbacks SET status = ? WHERE id = ?', [status, id]);

        return reply.send({
            success: true,
            message: 'Status feedback berhasil diupdate',
        });
    } catch (error) {
        console.error('Update feedback status error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal mengupdate status feedback',
        });
    }
}

/**
 * Delete feedback (admin only)
 */
export async function deleteFeedback(request, reply) {
    try {
        const { id } = request.params;

        const existing = queryOne('SELECT id FROM feedbacks WHERE id = ?', [id]);
        if (!existing) {
            return reply.code(404).send({
                success: false,
                message: 'Feedback tidak ditemukan',
            });
        }

        execute('DELETE FROM feedbacks WHERE id = ?', [id]);

        return reply.send({
            success: true,
            message: 'Feedback berhasil dihapus',
        });
    } catch (error) {
        console.error('Delete feedback error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal menghapus feedback',
        });
    }
}

/**
 * Get feedback stats (admin only)
 */
export async function getFeedbackStats(request, reply) {
    try {
        const stats = queryOne(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'unread' THEN 1 ELSE 0 END) as unread,
                SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) as read,
                SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved
            FROM feedbacks
        `);

        return reply.send({
            success: true,
            data: stats,
        });
    } catch (error) {
        console.error('Get feedback stats error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal mengambil statistik feedback',
        });
    }
}
