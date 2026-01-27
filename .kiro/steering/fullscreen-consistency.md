# Fullscreen Consistency Rules

## CRITICAL: Grid View & MapView Consistency

Setiap perubahan yang mempengaruhi video player, fullscreen, atau zoom controls WAJIB diimplementasikan di KEDUA tempat:

### 1. Grid View (LandingPage.jsx)
- **VideoPopup** component (line ~585)
- **MultiViewVideoItem** component (line ~1360)

### 2. MapView (MapView.jsx)
- **VideoModal** component (line ~170)

## Fullscreen Close Button Rules

### WAJIB: Exit Fullscreen Before Close

Setiap close button atau close handler WAJIB:

1. **Check fullscreen state** dengan `document.fullscreenElement`
2. **Exit fullscreen** dengan `await document.exitFullscreen()`
3. **Wait 100ms** untuk transition selesai: `await new Promise(resolve => setTimeout(resolve, 100))`
4. **Baru close modal** dengan `onClose()` atau `onRemove()`

### Template handleClose Function

```javascript
const handleClose = async () => {
    // Exit fullscreen first if active
    if (document.fullscreenElement) {
        try {
            await document.exitFullscreen?.();
            // Wait for fullscreen transition to complete
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            console.error('Error exiting fullscreen:', error);
        }
    }
    
    // Then close modal
    onClose(); // or onRemove() for MultiViewVideoItem
};
```

### Kenapa 100ms Delay Diperlukan?

**Race Condition**: `exitFullscreen()` adalah async operation yang butuh waktu untuk:
- Trigger browser fullscreen API
- Animate transition keluar dari fullscreen
- Update DOM state
- Fire fullscreenchange event

Tanpa delay, `onClose()` akan unmount component sebelum browser selesai exit fullscreen → **BLANK SCREEN**

## Implementation Checklist

Saat membuat perubahan pada video player:

- [ ] Implementasi di VideoPopup (LandingPage.jsx)
- [ ] Implementasi di MultiViewVideoItem (LandingPage.jsx)
- [ ] Implementasi di VideoModal (MapView.jsx)
- [ ] Test di grid view (desktop & mobile)
- [ ] Test di map view (desktop & mobile)
- [ ] Test fullscreen mode di semua view
- [ ] Verify no blank screen saat close

## Common Mistakes to Avoid

### ❌ JANGAN:
```javascript
// Langsung close tanpa exit fullscreen
const handleClose = () => {
    onClose(); // BUG: Blank screen di mobile!
};

// Exit fullscreen tanpa await
const handleClose = async () => {
    document.exitFullscreen(); // BUG: Race condition!
    onClose();
};

// Await tanpa delay
const handleClose = async () => {
    await document.exitFullscreen(); // BUG: Masih race condition!
    onClose(); // Component unmount terlalu cepat
};

// DOUBLE EXIT FULLSCREEN (child + parent)
// Child component:
const handleClose = async () => {
    await document.exitFullscreen(); // Exit di child
    onClose(); // Call parent
};
// Parent component:
const closeModal = async () => {
    await document.exitFullscreen(); // Exit LAGI di parent → RACE CONDITION!
    setModalCamera(null);
};
```

### ✅ SELALU:
```javascript
// Exit fullscreen dengan await + delay
const handleClose = async () => {
    if (document.fullscreenElement) {
        try {
            await document.exitFullscreen?.();
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            console.error('Error exiting fullscreen:', error);
        }
    }
    onClose();
};

// ATAU jika parent sudah handle fullscreen exit:
// Child component - hanya call onClose
const handleClose = () => {
    onClose(); // Parent akan handle fullscreen exit
};
// Parent component - handle fullscreen exit
const closeModal = async () => {
    if (document.fullscreenElement) {
        await document.exitFullscreen?.();
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    setModalCamera(null);
};
```

## Testing Requirements

Setiap perubahan fullscreen/close button WAJIB test:

1. **Desktop Chrome**: Close button di fullscreen
2. **Desktop Firefox**: Close button di fullscreen
3. **Mobile Chrome**: Close button di fullscreen landscape
4. **Mobile Safari**: Close button di fullscreen landscape
5. **Grid View**: Semua scenario di atas
6. **Map View**: Semua scenario di atas

## Bug History

### Bug: Double Fullscreen Exit in MapView (Fixed)
- **Date**: 2025-01-28
- **Cause**: VideoModal `handleClose` dan parent `closeModal` sama-sama exit fullscreen → race condition
- **Solution**: VideoModal `handleClose` hanya call `onClose()`, biarkan parent handle fullscreen exit
- **Files**: MapView.jsx
- **Commit**: "Fix: Remove duplicate fullscreen exit in VideoModal handleClose - parent closeModal already handles it"
- **Lesson**: Jangan exit fullscreen di child component jika parent sudah handle

### Bug: Blank Screen on Close (Fixed)
- **Date**: 2025-01-28
- **Cause**: `onClose()` called before `exitFullscreen()` completed
- **Solution**: Add 100ms delay after `await exitFullscreen()`
- **Files**: LandingPage.jsx, MapView.jsx
- **Commit**: "Fix: Add 100ms delay after exitFullscreen to prevent blank screen"

### Bug: Duplicate X Icons (Fixed)
- **Date**: 2025-01-28
- **Cause**: Fullscreen button using X icon instead of minimize icon
- **Solution**: Change fullscreen button icon to 4-arrows minimize icon
- **Files**: MapView.jsx
- **Commit**: "Fix: Close button issues in fullscreen - exit fullscreen before closing modal, fix duplicate X icons"
