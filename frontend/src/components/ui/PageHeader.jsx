/*
 * Purpose: One page-header block for every admin route — eyebrow, title, context line, meta, actions.
 * Caller: admin pages (via components/ui barrel).
 * Deps: React only.
 * MainFuncs: PageHeader.
 * SideEffects: None.
 *
 * Why this exists: each admin page hand-built its own header, so heading level, type size, spacing
 * and the position of the action buttons drifted page to page. A fixed h1 also gives every route a
 * correct document outline, which the audit found missing.
 *
 * ---------------------------------------------------------------------------------------------
 * THE TITLE SIZE IS `text-xl sm:text-2xl` AND IT WAS MEASURED, NOT PREFERRED. Please read before
 * changing it — this was settled once with numbers so it does not get re-litigated per page.
 * ---------------------------------------------------------------------------------------------
 *
 * Before this decision the admin surface carried SEVEN title sizes: this component's `text-xl`
 * (10 routes), `text-2xl` (11), `text-3xl` (1), `text-xl` without tracking (1), `text-xl
 * font-semibold` (3), `text-xl sm:text-2xl` (3) and `text-lg` (1). The majority value was LARGER
 * than the shared primitive's, so the ten routes that DID adopt it rendered a title visibly
 * smaller than the nineteen that did not — the primitive made a page look subordinate.
 *
 * All 28 real admin page titles were rendered in a real browser inside the AdminLayout box
 * (`px-4`, `lg:ml-72 lg:px-8`) and the wrapped-title count taken at each width and root font:
 *
 *              320px/16px   320px/24px   393px/16px   393px/24px   >=640px/16px
 *   text-xl      0 / 28       9 / 28       0 / 28       3 / 28        0 / 28
 *   text-2xl     3 / 28      20 / 28       0 / 28       5 / 28        0 / 28
 *
 * So the two criteria genuinely disagree, and they disagree only below `sm`:
 *
 *   - PHONE, and especially at the 1.5x accessibility font the e2e guard tests: `text-2xl` puts a
 *     TWO-LINE title on 20 of 28 admin pages at 320px/24px, against 9 for `text-xl`, and leaves
 *     the tightest one-line title just 3px of slack at 393px/24px against 43px. "Dasbor Rekaman"
 *     — fourteen characters — wraps at `text-2xl`. That is not an edge case, it is most of admin.
 *   - DESKTOP: `text-xl` is 20px, and the admin tree already renders SEVEN `<h2>` section
 *     headings at `text-xl` (20px) and thirty-two at `text-lg` (18px). An h1 at `text-xl` is
 *     therefore the same size as some section headings and 2px from the rest — no hierarchy at
 *     all. At `text-2xl` (24px) the title clears every heading below it, including the shared
 *     CardTitle (`text-sm`), and reads 1.71x the `text-sm` description instead of 1.43x.
 *
 * The disagreement lands exactly on `sm` (640px), which is already where this header stops
 * stacking and the title starts sharing its row with `actions`. One rule, one breakpoint, one
 * story: while the title owns the full width of a phone it stays 20px; once it shares a row on a
 * screen wide enough to carry it, it goes to 24px. Below `sm` this is provably identical to the
 * mobile-best option and above it to the desktop-best one, which no single fixed value can be.
 * It is also not a new eighth variant — BillingManagement, CustomerCameraIPs and
 * TelegramArchiveSettings already shipped this exact pair by hand.
 *
 * NO CARD WRAPPER, deliberately, and there is no prop for one. RecordingDashboard was the only
 * route that boxed its header in `rounded-2xl border bg-surface p-5`; measured against the same
 * header bare, the panel costs the title 42px of line at 320px and 62px at 320px/1.5x (288 -> 246,
 * 272 -> 210) and turns a one-line title into two at 320px. It also says the wrong thing: the
 * surface/edge tokens mark a content GROUPING, so panelling the h1 files the page's own identity
 * as one of its sections. A `card` prop would hand every migration a per-page knob and rebuild the
 * drift this component exists to end. That page drops the wrapper instead.
 */

// Small, uppercase and letterspaced rather than the `text-sm` the six hand-rolled eyebrows used.
// At `text-sm` an eyebrow is the same 14px as the `description` right under it, so only the brand
// colour separates them — meaning carried by colour alone, and on a red-branded deployment a
// coloured line above a title can read as an alert. Size + weight + case + colour is four signals,
// three of which survive without colour. Both treatments measured identically for wrapping.
const EYEBROW = 'text-xs font-semibold uppercase tracking-wide text-primary';

/**
 * @param {string} title rendered as the page's single h1
 * @param {string} [eyebrow] short category label above the title (e.g. "Operations"); not a heading
 * @param {string} [description] one short line of context under the title
 * @param {React.ReactNode} [meta] inline status/timestamp chips shown beside the title
 * @param {React.ReactNode} [actions] page-level actions, right-aligned on wide screens
 */
export function PageHeader({ title, eyebrow = null, description = null, meta = null, actions = null, className = '' }) {
    return (
        // `flex-col` until `sm` + `min-w-0` on the text column + `shrink-0` on the actions is the
        // whole squeeze fix: a header that goes straight to `justify-between` (SponsorManagement's
        // hand-roll did) hands the title only 179px of a 320px phone and pushes its own button 90px
        // off screen at 1.5x font. Measured 0px overflow here at 320/393/1440 x 1x/1.5x.
        <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${className}`}>
            <div className="min-w-0">
                {eyebrow && <p className={EYEBROW}>{eyebrow}</p>}
                {/* `break-words` because `title` is a prop: AnalyticsWorkspace already passes one
                    through, so a camera or customer name can reach this h1 and an unbreakable
                    string is the exact family of defect that produced the 584px admin overflow. */}
                <h1 className={`${eyebrow ? 'mt-1 ' : ''}text-xl font-bold tracking-tight text-content break-words sm:text-2xl`}>
                    {title}
                </h1>
                {description && <p className="mt-1 text-sm text-content-muted">{description}</p>}
                {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}
