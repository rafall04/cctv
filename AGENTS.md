# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-26
**Commit:** N/A
**Branch:** main

## OVERVIEW
RAF NET Secure CCTV Hub - A secure, high-performance video streaming system isolating private IP cameras from public exposure while providing web access via MediaMTX (RTSP to HLS). 
Stack: Node.js 20+, Fastify, SQLite (better-sqlite3), React 18, Vite, Tailwind CSS, HLS.js.

## STRUCTURE
```
.
├── backend/       # Fastify API, Database, Services, Diagnostics
├── frontend/      # React 18 SPA (Vite + Tailwind)
├── deployment/    # Infrastructure, Nginx/Apache configs, Docker, Bash deployment scripts
└── AGENTS.md      # Root knowledge base
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Backend Business Logic | `backend/services/` | Singleton services (SOA pattern) |
| Database Schema/Migrations | `backend/database/migrations/` | SQLite with snake_case tables |
| Frontend UI Components | `frontend/src/components/` | Atomic/Adaptive UI pattern |
| Frontend Pages | `frontend/src/pages/` | Requires grouping/refactoring |
| Deployment/Infra | `deployment/` | Bash scripts and Mediamtx config |
| System Utilities | `frontend/src/utils/` | Codec, validators, animation tools |

## CONVENTIONS
- **Styling**: Tailwind CSS exclusively (`primary`, `dark:bg-amber-950/30`). Adaptive UX (HP Kentang Optimization) disabling heavy animations for low-end devices.
- **State Management**: React Context (global) + useState. Mode switching using separate URL params (e.g., `?cam=` vs `?camera=`).
- **Backend APIs**: `backend/server.js` entrypoint. Uniform response `{ success: true, data: ... }`. Parameterized SQL using `?`. Error handling mapping HTTP status codes.
- **Testing**: Vitest + `fast-check` for Property-Based Testing. File naming: `*.property.test.js`. Tests are mapped to functional requirements via JSDoc.
- **Security**: Fingerprinting using SHA256 (IP + User-Agent). Strict audit logging on Create/Update/Delete. 90-day log retention.

## ANTI-PATTERNS (THIS PROJECT)
- **React Hooks**: NEVER place hooks after conditional returns (React Error #310).
- **MediaMTX**: Frontend NEVER accesses MediaMTX directly. Strictly proxied by backend.
- **Data Integrity**: NEVER delete `.mp4` files manually in logic; segment scanner handles cleanup. NEVER delete files < 30m old.
- **Deployment**: DO NOT edit generated scripts manually. DO NOT add CORS in Apache (Fastify handles it). DO NOT use `lowLatency` MediaMTX variant.
- **Caching**: NEVER cache the Service Worker (`nginx.conf`).
- **URLs**: DO NOT reuse the same URL parameter for different features (live vs playback).
- **Strict ES Modules**: NEVER use `module.exports` or `require()`. Enforce `import/export` everywhere. Mixing CommonJS and ES Modules causes heavy backend crashes in this `type: module` repo.
- **Strict Async I/O**: NEVER use synchronous I/O functions like `fs.readFileSync`, `fs.existsSync`, or `execFileSync`. Enforce `fs.promises` and appropriate async wrappers.
- **Concurrency Safety**: NEVER delete files manually without locks. `recordingCore` relies on `LockManager` to prevent race conditions during file deletions (e.g., in `houseKeeper`).

## UNIQUE STYLES
- **Configuration-Driven UI**: Core UI components (`Alert`, `NetworkStatusBanner`) map `CONFIG` objects to styles/icons.
- **LINE#ID Tagging**: Codebase uses `LINE#ID` tagging in internal representation for high-precision edits.

## COMMANDS
```bash
# Backend
cd backend && npm install && npm run dev
npm run migrate && npm run migrate-security
npm test -- [file]

# Frontend
cd frontend && npm install && npm run dev
npm run build
```

## NOTES
- **Refactoring Needs**: `ViewerAnalytics.jsx`, `CameraManagement.jsx`, `Dashboard.jsx` exceed 500 lines. Need modularization.
- **Overlaps**: `frontend/src/utils/validators.js` (RTSP validation) is much stricter than `backend/middleware/schemaValidators.js`. Sync required.
