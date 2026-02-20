import feedbackService from '../services/feedbackService.js';

export async function createFeedback(request, reply) {
    try {
        const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
        const feedback = feedbackService.createFeedback(request.body, ip);

        return reply.code(201).send({
            success: true,
            message: 'Terima kasih atas kritik dan saran Anda',
            data: { id: feedback.id },
        });
    } catch (error) {
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        console.error('Create feedback error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal menyimpan feedback',
        });
    }
}

export async function getAllFeedbacks(request, reply) {
    try {
        const { page = 1, limit = 20, status } = request.query;
        const result = feedbackService.getAllFeedbacks(page, limit, status);

        return reply.send({
            success: true,
            data: result.feedbacks,
            pagination: result.pagination,
        });
    } catch (error) {
        console.error('Get feedbacks error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal mengambil data feedback',
        });
    }
}

export async function updateFeedbackStatus(request, reply) {
    try {
        const { id } = request.params;
        const { status } = request.body;

        feedbackService.updateFeedbackStatus(id, status);

        return reply.send({
            success: true,
            message: 'Status feedback berhasil diupdate',
        });
    } catch (error) {
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        console.error('Update feedback status error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal mengupdate status feedback',
        });
    }
}

export async function deleteFeedback(request, reply) {
    try {
        const { id } = request.params;

        feedbackService.deleteFeedback(id);

        return reply.send({
            success: true,
            message: 'Feedback berhasil dihapus',
        });
    } catch (error) {
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        console.error('Delete feedback error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Gagal menghapus feedback',
        });
    }
}

export async function getFeedbackStats(request, reply) {
    try {
        const stats = feedbackService.getFeedbackStats();

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
