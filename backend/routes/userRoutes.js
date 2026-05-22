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
    getPasswordPolicyRequirements,
} from '../controllers/userController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';
import {
    createUserSchema,
    updateUserSchema,
    changePasswordSchema,
    changeOwnPasswordSchema,
    updateProfileSchema,
    userIdParamSchema,
} from '../middleware/schemaValidators.js';

export default async function userRoutes(fastify, options) {
    // Public route - password requirements (no auth needed)
    fastify.get('/password-requirements', getPasswordPolicyRequirements);

    // All other routes require authentication
    fastify.register(async function authenticatedRoutes(fastify) {
        fastify.addHook('onRequest', authMiddleware);

        // Profile routes (for current user)
        fastify.get('/profile', getProfile);
        
        fastify.put('/profile', {
            schema: updateProfileSchema,
            handler: updateProfile,
        });
        
        fastify.put('/profile/password', {
            schema: changeOwnPasswordSchema,
            handler: changeOwnPassword,
        });

        // User management routes (admin role required — not just any logged-in user)
        fastify.get('/', { onRequest: [requireAdmin], handler: getAllUsers });

        fastify.get('/:id', {
            schema: userIdParamSchema,
            onRequest: [requireAdmin],
            handler: getUserById,
        });

        fastify.post('/', {
            schema: createUserSchema,
            onRequest: [requireAdmin],
            handler: createUser,
        });

        fastify.put('/:id', {
            schema: updateUserSchema,
            onRequest: [requireAdmin],
            handler: updateUser,
        });

        fastify.put('/:id/password', {
            schema: changePasswordSchema,
            onRequest: [requireAdmin],
            handler: changePassword,
        });

        fastify.delete('/:id', {
            schema: userIdParamSchema,
            onRequest: [requireAdmin],
            handler: deleteUser,
        });
    });
}
