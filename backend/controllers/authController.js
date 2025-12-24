import bcrypt from 'bcrypt';
import { queryOne, execute } from '../database/database.js';
import { config } from '../config/config.js';

export async function login(request, reply) {
    try {
        const { username, password } = request.body;

        // Validate input
        if (!username || !password) {
            return reply.code(400).send({
                success: false,
                message: 'Username and password are required',
            });
        }

        // Find user
        const user = queryOne(
            'SELECT id, username, password_hash, role FROM users WHERE username = ?',
            [username]
        );

        if (!user) {
            return reply.code(401).send({
                success: false,
                message: 'Invalid credentials',
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);

        if (!isValidPassword) {
            return reply.code(401).send({
                success: false,
                message: 'Invalid credentials',
            });
        }

        // Generate JWT token
        const token = request.server.jwt.sign({
            id: user.id,
            username: user.username,
            role: user.role,
        });

        // Log successful login
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'LOGIN', 'User logged in successfully', request.ip]
        );

        // Set cookie
        reply.setCookie('token', token, {
            path: '/',
            httpOnly: true,
            secure: config.server.env === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60, // 7 days
        });

        return reply.send({
            success: true,
            message: 'Login successful',
            data: {
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                },
            },
        });
    } catch (error) {
        console.error('Login error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function logout(request, reply) {
    try {
        // Log logout action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'LOGOUT', 'User logged out', request.ip]
        );

        // Clear cookie
        reply.clearCookie('token', { path: '/' });

        return reply.send({
            success: true,
            message: 'Logout successful',
        });
    } catch (error) {
        console.error('Logout error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function verifyToken(request, reply) {
    try {
        // Token already verified by middleware
        return reply.send({
            success: true,
            data: {
                user: request.user,
            },
        });
    } catch (error) {
        console.error('Verify token error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}
