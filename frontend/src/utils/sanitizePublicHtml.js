/*
 * Purpose: Sanitize limited public HTML before rendering in public landing surfaces.
 * Caller: Public hero and other settings-driven public copy surfaces.
 * Deps: Browser DOMParser when available.
 * MainFuncs: sanitizePublicHtml.
 * SideEffects: None.
 */

const SAFE_TAGS = new Set(['strong', 'em', 'br', 'span', 'a']);

function sanitizeHref(value) {
    const href = String(value || '').trim();
    if (!href) {
        return '';
    }

    try {
        const url = new URL(href, window.location.origin);
        if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
            return url.toString();
        }
    } catch {
        return '';
    }

    return '';
}

function sanitizeNode(node, doc) {
    if (node.nodeType === Node.TEXT_NODE) {
        return doc.createTextNode(node.textContent || '');
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return doc.createTextNode('');
    }

    const tagName = String(node.tagName || '').toLowerCase();
    if (!SAFE_TAGS.has(tagName)) {
        const fragment = doc.createDocumentFragment();
        node.childNodes.forEach((child) => {
            fragment.appendChild(sanitizeNode(child, doc));
        });
        return fragment;
    }

    const cleanElement = doc.createElement(tagName);
    if (tagName === 'a') {
        const safeHref = sanitizeHref(node.getAttribute('href'));
        if (safeHref) {
            cleanElement.setAttribute('href', safeHref);
            cleanElement.setAttribute('rel', 'noopener noreferrer');
            cleanElement.setAttribute('target', '_blank');
        }
    }

    if (tagName === 'span') {
        const className = String(node.getAttribute('class') || '').trim();
        if (className) {
            cleanElement.setAttribute('class', className);
        }
    }

    node.childNodes.forEach((child) => {
        cleanElement.appendChild(sanitizeNode(child, doc));
    });

    return cleanElement;
}

export function sanitizePublicHtml(html = '') {
    const input = String(html || '');
    if (!input) {
        return '';
    }

    const parser = new DOMParser();
    const parsed = parser.parseFromString(`<div>${input}</div>`, 'text/html');
    const wrapper = parsed.body?.firstElementChild;
    if (!wrapper) {
        return '';
    }

    const documentFragment = document.createDocumentFragment();
    wrapper.childNodes.forEach((child) => {
        documentFragment.appendChild(sanitizeNode(child, document));
    });

    const container = document.createElement('div');
    container.appendChild(documentFragment);
    return container.innerHTML;
}

export default sanitizePublicHtml;
