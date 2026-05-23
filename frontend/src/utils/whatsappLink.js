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
*/

export const DEFAULT_WHATSAPP_TEMPLATE =
    'Halo Admin {{company_name}}, saya ingin tanya soal {{page}}.';

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

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
    const number = String(branding?.whatsapp_number || '').trim();
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
