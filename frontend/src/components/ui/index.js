/*
 * Admin design primitives (2026-07 admin reconstruction). These replace the hand-rolled shells the
 * audit counted across the admin surface — 20+ card variants, 11 dialogs, 10 stat tiles, 5 input
 * chromes. Reach for one of these before writing a new class string; the token, focus and
 * touch-target rules live inside them so they stop being per-author decisions.
 * Scale + usage rules: docs/frontend-guide.md.
 */
export { Button, IconButton, BUTTON_VARIANTS } from './Button';
export { Card, CardHeader, CardTitle, CardBody, CardFooter } from './Card';
export { Badge, StatusDot, TONE_CLASSES } from './Badge';
export { PageHeader } from './PageHeader';
export { Modal, ModalFooter } from './Modal';
export { TableShell, Table, THead, TBody, TR, TH, TD, SortableTH } from './DataTable';
export { Tabs, TabPanel } from './Tabs';
export { StatTile, MeterBar, SegmentedBar, loadTone } from './StatTile';
export { Toolbar, SearchInput } from './Toolbar';
export { Field, inputClasses } from './Field';

export { Toast } from './Toast';
export { ToastContainer } from './ToastContainer';
export { Alert, getAlertConfig, ALERT_CONFIG } from './Alert';
export { 
    Skeleton,
    CameraCardSkeleton,
    TableRowSkeleton,
    TableSkeleton,
    StatCardSkeleton,
    ListItemSkeleton,
    FormSkeleton,
    GridSkeleton,
    DashboardSkeleton
} from './Skeleton';
export { 
    EmptyState, 
    NoCamerasEmptyState, 
    NoAreasEmptyState, 
    NoUsersEmptyState, 
    NoActivityEmptyState, 
    NoSearchResultsEmptyState, 
    NoStreamsEmptyState,
    EMPTY_STATE_ICONS 
} from './EmptyState';
export { 
    FormField, 
    getCharacterCount, 
    isOverCharacterLimit 
} from './FormField';
export { 
    NetworkStatusBanner, 
    getBannerConfig 
} from './NetworkStatusBanner';
