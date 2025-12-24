import {
    getAllUsers,
    getUserById,
    createUser,
    updateUser,
    changePassword,
    deleteUser,
    getProfile,
    updateProfile,
    changeOwnPassword,
} from '../controllers/userController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export default async function userRoutes(fastify, options) {
    // All routes require authentication
    fastify.addHook('onRequest', authMiddleware);

    // Profile routes (for current user)
    fastify.get('/profile', getProfile);
    fastify.put('/profile', updateProfile);
    fastify.put('/profile/password', changeOwnPassword);

    // User management routes (admin)
    fastify.get('/', getAllUsers);
    fastify.get('/:id', getUserById);
    fastify.post('/', createUser);
    fastify.put('/:id', updateUser);
    fastify.put('/:id/password', changePassword);
    fastify.delete('/:id', deleteUser);
}
