# AGENTS.md - Agentic Coding Guidelines

This file provides guidelines for AI agents working in this repository.

## Project Overview

RAF NET Secure CCTV Hub - A secure, high-performance video streaming system that isolates private IP cameras from public exposure while providing public web access to camera streams.

**Tech Stack:**
- **Backend:** Node.js 20+, Fastify 4.28.1, SQLite (better-sqlite3), JWT auth, ES modules
- **Frontend:** React 18.3.1, Vite 5.3.1, Tailwind CSS 3.4.4, HLS.js, Leaflet
- **Streaming:** MediaMTX v1.9.0 (RTSP to HLS)

---

## Build, Lint, and Test Commands

### Backend Commands

```bash
# Install dependencies
cd backend && npm install

# Run development server (with hot reload)
npm run dev

# Start production server
npm start

# Setup database
npm run setup-db

# Run migrations
npm run migrate

# Run security migrations
npm run migrate-security

# Run all tests
npm test

# Run tests in watch mode
npm test:watch

# Run a single test file
npm test -- cameraService.test.js

# Run a single test
npm test -- cameraService.test.js -t "test name"
```

### Frontend Commands

```bash
# Install dependencies
cd frontend && npm install

# Run development server (Vite)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run ESLint
npm run lint

# Run all tests
npm test

# Run tests in watch mode
npm test:watch

# Run a single test file
npm test -- CameraManagement.test.jsx

# Run a single test
npm test -- CameraManagement.test.jsx -t "test name"
```

---

## Code Style Guidelines

### General Principles

- Use ES modules (import/export syntax)
- Use 4 spaces for indentation (not tabs)
- Use single quotes for strings
- Use async/await over raw promises
- Use `console.log` for debugging, structured logging via pino-pretty for production
- Add error.statusCode property to thrown errors for HTTP status codes (e.g., `err.statusCode = 404`)

### Backend (Node.js/Fastify)

**File Naming:**
- Use kebab-case: `cameraController.js`, `mediaMtxService.js`, `authMiddleware.js`

**Imports:**
- Use relative imports with `.js` extension
- Group imports: external libs → internal services → middleware → database

```javascript
import fs from 'fs';
import { query, execute } from '../database/connectionPool.js';
import cameraService from '../services/cameraService.js';
import { logAction } from '../services/securityAuditLogger.js';
```

**Functions:**
- Use named exports for route handlers
- Use class-based services with methods

```javascript
// Controller - named export, async handler
export async function getCameraById(request, reply) {
    try {
        const { id } = request.params;
        const camera = cameraService.getCameraById(id);
        return reply.send({ success: true, data: camera });
    } catch (error) {
        console.error('Get camera error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Service - class-based
class CameraService {
    getAllCameras() {
        return query('SELECT * FROM cameras ORDER BY id ASC');
    }
}
export default new CameraService();
```

**Database Queries:**
- Use parameterized queries with `?` placeholders
- Use `query()` for SELECT, `execute()` for INSERT/UPDATE/DELETE
- Use `queryOne()` for single row results

```javascript
const camera = queryOne(
    'SELECT c.*, a.name as area_name FROM cameras c LEFT JOIN areas a ON c.area_id = a.id WHERE c.id = ?',
    [id]
);
```

**Error Handling:**
- Attach `statusCode` property to custom errors
- Return consistent response format: `{ success: boolean, message?: string, data?: any }`

```javascript
if (!camera) {
    const err = new Error('Camera not found');
    err.statusCode = 404;
    throw err;
}
```

### Frontend (React)

**File Naming:**
- Use PascalCase for components: `CameraManagement.jsx`, `VideoPlayer.jsx`
- Use camelCase for utilities/hooks: `useFormValidation.js`, `validators.js`

**Components:**
- Use functional components with hooks
- Use named exports for page components, default exports for reusable components

```javascript
// Page component - named export
export default function CameraManagement() {
    const [cameras, setCameras] = useState([]);
    
    useEffect(() => {
        loadCameras();
    }, []);

    return ( ... );
}
```

**Imports:**
- Group in this order: React → external libs → internal components → internal hooks/utils → styles

```jsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { cameraService } from '../services/cameraService';
import { useNotification } from '../contexts/NotificationContext';
import { Alert } from '../components/ui/Alert';
import { Skeleton } from '../components/ui/Skeleton';
```

**State Management:**
- Use React Context for global state (theme, notifications, branding)
- Use local useState for component-specific state

**Forms:**
- Use custom `useFormValidation` hook
- Define validation rules as functions returning error messages

```javascript
const getValidationRules = () => ({
    name: {
        required: 'Camera name is required',
        minLength: { value: 2, message: 'Name must be at least 2 characters' },
    },
});
```

**Styling:**
- Use Tailwind CSS exclusively
- Use custom colors from theme: `primary`, `dark-*`, `light-*`
- Use semantic class names: `text-gray-600 dark:text-gray-300`

```jsx
<button className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-600 transition-colors">
    Save
</button>
```

**Error Boundaries:**
- Wrap components with ErrorBoundary for graceful error handling

---

## API Response Format

All API responses should follow this format:

```javascript
// Success
{ success: true, data: [...] }

// Success with message
{ success: true, message: 'Camera created successfully', data: {...} }

// Error
{ success: false, message: 'Error description' }
```

---

## Security Guidelines

- Never expose RTSP URLs to frontend - only HLS stream URLs
- Use JWT for authentication with 24h expiration
- Hash passwords with bcrypt
- Implement rate limiting on auth endpoints
- Validate and sanitize all user inputs
- Log security events via securityAuditLogger
- Use CSRF protection for state-changing operations

---

## Testing

- Tests go in `__tests__/` directory for backend
- Tests go in `src/__tests__/` for frontend (with `setup.js`)
- Use vitest for both backend and frontend
- Backend uses `node` environment, frontend uses `jsdom`
- Use property-based testing with `fast-check` for critical logic

---

## Database

- SQLite with better-sqlite3 (synchronous API)
- Store in `backend/data/cctv.db`
- Use migrations in `backend/database/migrations/`
- All table names use snake_case: `cameras`, `areas`, `users`

---

## Environment Configuration

- Backend: `backend/.env` file
- Frontend: `frontend/.env` file (prefix vars with `VITE_`)
- All configuration via environment variables, no hardcoded values

---

## Common Patterns

### Cache Invalidation
After mutations, invalidate relevant cache keys:
```javascript
import { invalidateCache } from '../middleware/cacheMiddleware.js';
invalidateCache('/api/cameras');
```

### Audit Logging
Log admin actions:
```javascript
import { logCameraCreated } from '../services/securityAuditLogger.js';
logCameraCreated(userId, cameraId, cameraName, request);
```

### File Paths
- Use path.resolve for file operations
- Store paths relative to project root

---

## Dependencies

### Backend Key Dependencies
- fastify ^4.28.1
- @fastify/jwt ^8.0.1
- better-sqlite3 ^11.7.0
- bcrypt ^5.1.1

### Frontend Key Dependencies
- react ^18.3.1
- vite ^5.3.1
- tailwindcss ^3.4.4
- hls.js ^1.5.15
