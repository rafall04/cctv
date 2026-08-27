/*
Purpose: Build a wa.me deep link from branding settings + optional page context, substituting {{placeholders}} in the admin-editable template.
Caller: LandingFooter, Playback page contact CTA, anywhere else a "chat admin" button gets rendered.
Deps: None — pure functions only.
MainFuncs: buildWhatsappLink, applyWhatsappTemplate, DEFAULT_WHATSAPP_TEMPLATE.
SideEffects: None.

Design notes:
  - Template substitution is intentionally dumb string replacement
    (no Mustache, no Handlebars). The placeholder set is fixed and
    small enough that a full templating engine would be overkill.
  - Empty / whitespace-only template falls back to the default so a
    fresh deployment without the migration still produces a sensible
    pre-fill text (defence in depth — the migration also seeds the
    same default).
  - Missing context fields render as empty strings ('{{camera_name}}'
    becomes '' on a non-camera page, NOT the literal placeholder).
    This keeps the rendered text natural-looking under partial data.
  - Returns '' (not '#') when the branding number is missing, so the
    caller can branch on truthiness without accidentally turning a
    broken link into a self-referential anchor.
  - The number is NORMALISED to wa.me's shape (digits, country code).
    Operators type the local `0812…` form — that is the form printed on
    every shopfront in the country — and wa.me silently fails on it.
    Handing it through raw produced a link that opened WhatsApp on a
    number that does not exist, which reads as "WhatsApp is broken"
    rather than "the setting is wrong". Same rule as the admin-side
    toWhatsAppDigits(), so a number typed once behaves the same
    everywhere it is rendered.
*/

export const DEFAULT_WHATSAPP_TEMPLATE =
    'Halo Admin {{company_name}}, saya ingin tanya soal {{page}}.';

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * `0812…`, `+62 812-…`, `62812…` all mean the same number; wa.me accepts only the last.
 * Mirrors toWhatsAppDigits() in services/affiliateAdminService.js.
 */
export function toWhatsappDigits(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
}

/**
 * Apply the template against a context object. Unknown placeholders
 * resolve to '' so leftover {{foo}} doesn't leak to the user.
 */
export function applyWhatsappTemplate(template, context = {}) {
    const source = typeof template === 'string' && template.trim()
        ? template
        : DEFAULT_WHATSAPP_TEMPLATE;
    return source.replace(PLACEHOLDER_REGEX, (_, key) => {
        const value = context?.[key];
        if (value === undefined || value === null) {
            return '';
        }
        return String(value);
    });
}

/**
 * @param {Object} branding - Branding settings object from BrandingContext.
 * @param {Object} [context] - Per-page substitutions.
 * @param {string} [context.page] - Human label for the page ("Beranda", "Playback CCTV").
 * @param {string} [context.camera_name] - Optional camera name when applicable.
 * @returns {string} A `https://wa.me/...?text=...` URL, or '' when no number is configured.
 */
export function buildWhatsappLink(branding, context = {}) {
    const number = toWhatsappDigits(branding?.whatsapp_number);
    if (!number) {
        return '';
    }

    const substitutionContext = {
        company_name: branding?.company_name || '',
        city_name: branding?.city_name || '',
        page: '',
        camera_name: '',
        ...context,
    };

    const message = applyWhatsappTemplate(
        branding?.whatsapp_message_template,
        substitutionContext
    );

    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
