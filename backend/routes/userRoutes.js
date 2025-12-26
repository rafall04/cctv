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
import { authMiddleware } from '../middleware/authMiddleware.js';
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

        // User management routes (admin)
        fastify.get('/', getAllUsers);
        
        fastify.get('/:id', {
            schema: userIdParamSchema,
            handler: getUserById,
        });
        
        fastify.post('/', {
            schema: createUserSchema,
            handler: createUser,
        });
        
        fastify.put('/:id', {
            schema: updateUserSchema,
            handler: updateUser,
        });
        
        fastify.put('/:id/password', {
            schema: changePasswordSchema,
            handler: changePassword,
        });
        
        fastify.delete('/:id', {
            schema: userIdParamSchema,
            handler: deleteUser,
        });
    });
}
