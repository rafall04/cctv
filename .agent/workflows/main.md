---
description: Complete project workflow for RAF NET CCTV
---

# RAF NET CCTV Project Workflow

This workflow outlines the standard procedures for development, maintenance, and verification of the RAF NET CCTV Hub.

## 1. Environment Setup
1.  **Backend**:
    - Navigate to `backend/`.
    - Run `npm install`.
    - Ensure `mediamtx.exe` is available in the root or configured path.
    - Start backend: `npm run dev`.
2.  **Frontend**:
    - Navigate to `frontend/`.
    - Run `npm install`.
    - Start frontend: `npm run dev`.
3.  **MediaMTX**:
    - Start MediaMTX with the provided config: `.\mediamtx.exe mediamtx.yml`.

## 2. Development Process
1.  **Database Changes**:
    - Update `backend/setup_db.js` for schema changes.
    - Run `node backend/setup_db.js` to apply changes (Warning: This may reset data).
2.  **API Development**:
    - Add routes in `backend/server.js`.
    - Implement logic in `backend/controllers/`.
    - Use `mediaMtxService.js` for any stream-related configurations.
3.  **Frontend Development**:
    - Create/Update components in `frontend/src/components/`.
    - Create/Update pages in `frontend/src/pages/`.
    - **CRITICAL**: Ensure all UI changes are responsive and tested on both Desktop and Mobile.

## 3. Efficiency & Performance
1.  **Stream Management**:
    - Always use `sourceOnDemand: true` in MediaMTX path configurations.
    - Implement "Click to Load" on the Landing Page to prevent unnecessary stream initialization.
2.  **Grouping**:
    - Use categories (RT/Gang) to organize cameras in both Admin and Landing pages.

## 4. Verification & Testing
1.  **Functional Testing**:
    - Verify Camera CRUD operations in Admin Panel.
    - Verify stream playback on Landing Page.
2.  **UI/UX Testing**:
    - **Desktop**: Check all layouts (Grid, Focus, Sidebar) and interactions (Zoom, Pan).
    - **Mobile**: Check responsiveness, touch interactions, and layout switching.
3.  **Performance Testing**:
    - Monitor CPU/Bandwidth usage with multiple cameras.
    - Ensure "Click to Load" is functioning as expected.

## 5. Deployment
1.  **Syncing**:
    - Run `node backend/sync_mediamtx.js` to ensure MediaMTX paths match the database.
2.  **Security**:
    - Verify JWT authentication is active for all admin routes.
    - Ensure no sensitive RTSP URLs are exposed in frontend API responses.
