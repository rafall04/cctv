import { query, queryOne, execute } from '../database/database.js';
import { sendFeedbackNotification } from './telegramService.js';

class FeedbackService {
    createFeedback(data, ip) {
        const { name, email, message } = data;

        if (!message || message.trim().length < 10) {
            const err = new Error('Pesan minimal 10 karakter');
            err.statusCode = 400;
            throw err;
        }

        if (message.length > 1000) {
            const err = new Error('Pesan maksimal 1000 karakter');
            err.statusCode = 400;
            throw err;
        }

        const result = execute(
            `INSERT INTO feedbacks (name, email, message, ip_address) VALUES (?, ?, ?, ?)`,
            [name?.trim() || null, email?.trim() || null, message.trim(), ip]
        );

        const feedback = queryOne('SELECT * FROM feedbacks WHERE id = ?', [result.lastInsertRowid]);

        sendFeedbackNotification(feedback).catch(err => {
            console.error('[Feedback] Failed to send Telegram notification:', err);
        });

        return feedback;
    }

    getAllFeedbacks(pageStr, limitStr, status) {
        const page = parseInt(pageStr) || 1;
        const limit = parseInt(limitStr) || 20;
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

        return {
            feedbacks,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            }
        };
    }

    updateFeedbackStatus(id, status) {
        const validStatuses = ['unread', 'read', 'resolved'];
        if (!validStatuses.includes(status)) {
            const err = new Error('Status tidak valid');
            err.statusCode = 400;
            throw err;
        }

        const existing = queryOne('SELECT id FROM feedbacks WHERE id = ?', [id]);
        if (!existing) {
            const err = new Error('Feedback tidak ditemukan');
            err.statusCode = 404;
            throw err;
        }

        execute('UPDATE feedbacks SET status = ? WHERE id = ?', [status, id]);
    }

    deleteFeedback(id) {
        const existing = queryOne('SELECT id FROM feedbacks WHERE id = ?', [id]);
        if (!existing) {
            const err = new Error('Feedback tidak ditemukan');
            err.statusCode = 404;
            throw err;
        }

        execute('DELETE FROM feedbacks WHERE id = ?', [id]);
    }

    getFeedbackStats() {
        return queryOne(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'unread' THEN 1 ELSE 0 END) as unread,
                SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) as read,
                SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved
            FROM feedbacks
        `);
    }
}

export default new FeedbackService();
