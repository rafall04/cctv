# RAF NET CCTV Project Rules & Best Practices

This document outlines the coding standards, architectural patterns, and best practices for the RAF NET CCTV project.

## 1. General Principles
- **Clean Code**: Write code that is easy to read and maintain. Use descriptive variable and function names.
- **DRY (Don't Repeat Yourself)**: Extract common logic into services, hooks, or utility functions.
- **KISS (Keep It Simple, Stupid)**: Avoid over-engineering. Choose the simplest solution that solves the problem robustly.
- **Consistency**: Follow existing patterns in the codebase (e.g., naming conventions, folder structure).

## 2. Frontend (React + Tailwind)
- **Component Structure**:
  - Keep components small and focused on a single responsibility.
  - Use functional components and hooks.
  - Place reusable components in `src/components` and pages in `src/pages`.
- **Styling**:
  - Use **Tailwind CSS** for all styling.
  - Avoid inline styles unless dynamic (e.g., zoom/pan transforms).
  - Use the design system tokens (colors like `primary-500`, `dark-900`) defined in `tailwind.config.js`.
- **UI Compatibility**:
  - **CRITICAL**: All UI changes MUST be compatible with both **Desktop and Mobile** devices.
  - Use responsive design patterns (e.g., `grid-cols-1 md:grid-cols-2`).
  - Ensure interactive elements (buttons, inputs) are touch-friendly on mobile.
  - Test all layouts (Grid, Focus, Sidebar) on both screen sizes.
- **Efficiency & Performance**:
  - **Click-to-Load**: Implement "Click to Load" for video streams to save bandwidth and CPU.
  - **On-Demand Loading**: Only initialize `VideoPlayer` when a user explicitly requests it.
- **State Management**:
  - Use `useState` for local component state.
  - Use `useRef` for DOM references (like `<video>` or containers).
  - Use `useEffect` carefully; always include proper cleanup functions (e.g., destroying HLS instances).
- **Video Playback**:
  - Always use `Hls.js` for streaming compatibility.
  - Ensure `object-contain` is used for full-screen/expanded views to prevent cropping.
  - Implement both Mouse and Touch events for interactive features (zoom/pan).

## 3. Backend (Fastify + SQLite)
- **Controller Pattern**:
  - Logic should reside in controllers (`backend/controllers`).
  - Keep routes clean; they should only map URLs to controller functions.
- **Database**:
  - Use `better-sqlite3` for performance.
  - Always use parameterized queries to prevent SQL injection.
  - Use transactions for operations affecting multiple tables.
- **MediaMTX Integration**:
  - Use `mediaMtxService.js` for all communications with the MediaMTX API.
  - **Efficiency**: Always set `sourceOnDemand: true` for camera paths to ensure streams are only pulled when requested.
  - Ensure path names are standardized (e.g., `camera${id}`).
  - Sync MediaMTX paths immediately upon camera creation, update, or deletion.
- **Error Handling**:
  - Return consistent JSON responses: `{ success: boolean, message: string, data?: any }`.
  - Use appropriate HTTP status codes (200, 201, 400, 401, 404, 500).

## 4. Security
- **Authentication**: Use JWT for admin routes.
- **Input Validation**: Validate all incoming request bodies in controllers.
- **Public vs Private**: Never expose RTSP URLs or sensitive camera credentials to the public frontend endpoints.

## 5. Git & Workflow
- **Commit Messages**: Use clear, imperative messages (e.g., "Fix: resolve mobile pan issue").
- **Documentation**: Update `task.md` and `walkthrough.md` when completing major features.
- **Testing**: Manually verify features on both Desktop and Mobile before finalizing.

---
*Last Updated: December 2025*
