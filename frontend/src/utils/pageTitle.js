/*
 * Purpose: Let a page claim the document title without the branding fetch stealing it back.
 * Caller: Pages that need their own title; BrandingContext asks before overwriting.
 * MainFuncs: setPageTitle, isPageTitleOwned.
 * SideEffects: Writes document.title and holds one module-level flag.
 *
 * WHY THIS EXISTS
 * BrandingContext sets document.title when its fetch resolves. That is asynchronous, so it landed
 * AFTER any page-level effect and quietly overwrote it: every tab, bookmark and shared link said
 * "CCTV Publik Online" no matter where the visitor was. AreaPublicPage appeared to work only
 * because its own data arrives later still — it won on timing, not by right.
 *
 * A claim, not a race: the last page to mount owns the title, and releases it on unmount so the
 * branding default takes over again.
 */

let pageOwnsTitle = false;

/** True while a page holds the title; branding must then leave it alone. */
export function isPageTitleOwned() {
    return pageOwnsTitle;
}

/**
 * Claim the title for this page. Returns the release function, so an effect can simply
 * `return setPageTitle('...')` and hand it back on unmount.
 */
export function setPageTitle(title) {
    pageOwnsTitle = true;
    document.title = title;

    return () => {
        pageOwnsTitle = false;
    };
}
