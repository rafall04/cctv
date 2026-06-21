<!--
Purpose: Frontend/React deep-dive conventions, extracted from AGENTS.md to keep the auto-loaded rulebook lean.
Caller: Read on demand when writing/editing React components, hooks, playback UI, or landing/map view modes.
Deps: AGENTS.md (core rules), SYSTEM_MAP.md (frontend entry points & flows).
-->

# Frontend Guide (React) — read on demand

> Deep-dive frontend conventions. The **always-loaded** core rules live in [AGENTS.md](../AGENTS.md);
> this file holds the detailed patterns/examples that are only relevant while doing frontend work.
> For "where does X live", see [SYSTEM_MAP.md](../SYSTEM_MAP.md).

## Frontend Structure (Target)

```
frontend/src/
├── pages/
│   ├── public/
│   │   ├── LandingPage.jsx
│   │   └── LoginPage.jsx
│   ├── admin/
│   │   ├── Dashboard.jsx
│   │   ├── CameraManagement.jsx
│   │   ├── AreaManagement.jsx
│   │   ├── UserManagement.jsx
│   │   ├── Playback.jsx
│   │   └── PlaybackAnalytics.jsx
│   └── settings/
│       └── UnifiedSettings.jsx
├── components/
│   ├── ui/                    # Base UI components (Button, Input, Modal)
│   │   ├── Alert.jsx
│   │   ├── Button.jsx
│   │   ├── EmptyState.jsx
│   │   ├── ErrorBoundary.jsx
│   │   ├── FormField.jsx
│   │   ├── Icons.jsx
│   │   ├── Skeleton.jsx
│   │   ├── ThemeSwitcher.jsx
│   │   └── Toast.jsx
│   ├── common/                # Reusable business components
│   │   ├── DataTable.jsx     # CRUD tables with sorting/filtering
│   │   ├── SearchBar.jsx
│   │   ├── FilterBar.jsx
│   │   └── ConfirmDialog.jsx
│   ├── landing/               # Landing page components
│   │   ├── LandingNavbar.jsx
│   │   ├── LandingFooter.jsx
│   │   ├── LandingHero.jsx
│   │   ├── LandingCameraCard.jsx
│   │   ├── LandingCamerasSection.jsx
│   │   ├── LandingFilterDropdown.jsx
│   │   └── LandingStatsBar.jsx
│   ├── playback/               # Playback presentation components
│   │   ├── PlaybackHeader.jsx
│   │   ├── PlaybackVideo.jsx
│   │   ├── PlaybackTimeline.jsx
│   │   └── PlaybackSegmentList.jsx
│   ├── admin/                 # Admin-specific components
│   │   ├── CameraCard.jsx
│   │   ├── StatsWidget.jsx
│   │   └── ...
│   └── features/              # Feature-based components
│       ├── video/
│       │   ├── VideoPlayer.jsx
│       │   ├── VideoPopup.jsx
│       │   ├── ZoomableVideo.jsx
│       │   └── MultiView/
│       └── maps/
│           └── MapView.jsx
├── contexts/                  # React Context (global state)
├── hooks/                     # Custom hooks
│   ├── useCameraHistory.js   # Favorites & recent cameras (localStorage)
│   ├── useCameraStatusTracker.js
│   └── ...
├── services/                  # API services
├── utils/                     # Utility functions
└── config/                   # Configuration
```

## Code Style (React) — full examples

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

## React Hooks Best Practices & Race Condition Prevention

### Critical Rules for React Hooks

1. **ALWAYS place ALL hooks (useState, useEffect, useCallback, useRef) BEFORE any conditional returns**
   - React Error #310 occurs when hooks are called inconsistently between renders
   - Example of WRONG code:
   ```javascript
   function Component() {
       const [value, setValue] = useState(0);

       if (value === 0) {
           return <div>Zero</div>; // WRONG - hooks called after conditional return
       }

       useEffect(() => { ... }, [value]); // This will cause Error #310
       return <div>{value}</div>;
   }
   ```

2. **Use `useRef` to avoid stale closures in async operations**
   ```javascript
   function Component() {
       const [data, setData] = useState(null);
       const dataRef = useRef(null);

       useEffect(() => {
           dataRef.current = data;
       }, [data]);

       const handleAsync = async () => {
           // Use dataRef.current instead of data to avoid stale closure
           const currentData = dataRef.current;
       };
   }
   ```

3. **For async media/session starts, guard duplicate event bursts with a pending ref/token**
   - Repeated media events like `playing` can fire before the first async start finishes
   - Use a `pendingKeyRef` / `pendingTokenRef` pattern so the same playback segment does not create duplicate sessions

### Mode Switching (LandingPage View Modes)

When switching between view modes (map/grid/playback), follow these patterns:

1. **Use separate route params for different modes**
   - Live stream: `/?camera=1` (map/grid mode)
   - Playback: `/?cam=1&t=timestamp` (playback mode)
   - DON'T use same param (`camera`) for both - it causes popup to open unexpectedly

2. **Check current mode before updating URL**
   ```javascript
   useEffect(() => {
       if (viewMode === 'playback') return; // Don't run in playback mode
       // ... handle camera URL param
   }, [cameras, searchParams, viewMode]);
   ```

3. **Always add cleanup in useEffect for async operations**
   ```javascript
   useEffect(() => {
       let isMounted = true;

       fetchData().then(result => {
           if (isMounted) {
               setData(result);
           }
       });

       return () => { isMounted = false; };
   }, [dependency]);
   ```

### URL Parameter Best Practices

1. **Use distinct parameter names for different features**
   - Don't reuse `camera` param for both live stream and playback
   - Use `cam` for playback, `camera` for live stream

2. **Parse URL params in correct order**
   ```javascript
   // First: parse camera from URL
   const cameraIdFromUrl = searchParams.get('cam');

   // Second: fetch data based on camera
   useEffect(() => {
       if (cameraIdFromUrl) {
           fetchSegments(cameraIdFromUrl);
       }
   }, [cameraIdFromUrl]);

   // Third: select segment from URL after data loads
   useEffect(() => {
       if (segments.length > 0) {
           const segmentId = searchParams.get('t');
           // find and select segment
       }
   }, [segments, searchParams]);
   ```

3. **Avoid race condition between URL update and state selection**
   - Update URL FIRST, then set state
   ```javascript
   const handleSegmentClick = (segment) => {
       // Update URL first
       setSearchParams({ cam: cameraId, t: timestamp }, { replace: false });
       // Then update state
       setSelectedSegment(segment);
   };
   ```

4. **Keep playback route scope and share params separate**
   - Public playback stays on `/playback`
   - Admin full playback stays on `/admin/playback`
   - Playback sharing still uses `cam` and `t`; admin scope must not leak into public share links

### Share Link Best Practices

1. **Use stable identifiers (timestamps) instead of IDs**
   - Segment IDs can change when new segments are created
   - Use `start_time` timestamp as stable identifier
   - URL: `?cam=1&t=1708483200` (timestamp) instead of `?cam=1&segment=5`

2. **Handle missing data gracefully**
   ```javascript
   const targetSegment = segments.find(s =>
       s.start_time <= targetTime && s.end_time >= targetTime
   );
   if (!targetSegment) {
       // Fallback to closest segment
       const closest = findClosestSegment(targetTime);
       setSelectedSegment(closest);
   }
   ```

### Performance Optimizations

1. **Extract clock/time updates to separate component**
   ```javascript
   function ClockDisplay() {
       const timeRef = useRef(null);

       useEffect(() => {
           const updateTime = () => {
               if (timeRef.current) {
                   timeRef.current.textContent = new Date().toLocaleTimeString();
               }
           };
           updateTime();
           const interval = setInterval(updateTime, 1000);
           return () => clearInterval(interval);
       }, []);

       return <span ref={timeRef} />;
   }
   ```

2. **Use `useMemo` for filtered/computed lists**
   ```javascript
   const filteredCameras = useMemo(() => {
       return cameras.filter(c => c.is_tunnel === 1);
   }, [cameras]);
   ```

3. **Memoize components that re-render frequently**
   ```javascript
   const Hero = memo(function Hero({ title }) {
       return <h1>{title}</h1>;
   });
   ```

4. **Lazy load heavy components**
   ```javascript
   const MapView = lazy(() => import('../MapView'));
   const Playback = lazy(() => import('../../pages/Playback'));
   ```
