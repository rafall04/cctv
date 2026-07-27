/*
 * Purpose: Page header for the camera management route.
 * Caller: pages/CameraManagement.jsx.
 * Deps: components/ui PageHeader + Button.
 * MainFuncs: CameraManagementHeader.
 * SideEffects: None.
 *
 * Was the last admin header still in English ("Hardware Management / Cameras / Configure and
 * monitor your CCTV endpoints"), and its eyebrow used the brand colour — which on this deployment
 * is red, so the page opened with a red line of text that read as an alarm. The eyebrow carried no
 * information the title did not, so it is gone rather than recoloured.
 */

import { Button, PageHeader } from '../../ui';

const PlusIcon = () => (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
);

export default function CameraManagementHeader({ onAddCamera }) {
    return (
        <PageHeader
            title="Kamera"
            description="Atur dan pantau seluruh titik CCTV."
            actions={(
                <Button variant="primary" onClick={onAddCamera} icon={<PlusIcon />}>
                    Tambah Kamera
                </Button>
            )}
        />
    );
}
