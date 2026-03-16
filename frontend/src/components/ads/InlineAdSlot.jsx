import { useEffect, useMemo, useRef, useState } from 'react';

function appendMarkup(target, markup) {
    if (!target) {
        return [];
    }

    const cleanupNodes = [];
    const trimmedMarkup = typeof markup === 'string' ? markup.trim() : '';

    if (!trimmedMarkup) {
        return cleanupNodes;
    }

    if (trimmedMarkup.startsWith('<') && !trimmedMarkup.includes('<script')) {
        const template = document.createElement('template');
        template.innerHTML = trimmedMarkup;

        Array.from(template.content.childNodes).forEach((node) => {
            const clonedNode = node.cloneNode(true);
            target.appendChild(clonedNode);
            cleanupNodes.push(clonedNode);
        });

        return cleanupNodes;
    }

    if (!trimmedMarkup.includes('<script')) {
        const inlineScript = document.createElement('script');
        inlineScript.type = 'text/javascript';
        inlineScript.textContent = trimmedMarkup;
        target.appendChild(inlineScript);
        cleanupNodes.push(inlineScript);
        return cleanupNodes;
    }

    const template = document.createElement('template');
    template.innerHTML = trimmedMarkup;

    Array.from(template.content.childNodes).forEach((node) => {
        if (node.nodeName.toLowerCase() === 'script') {
            const originalScript = node;
            const script = document.createElement('script');

            Array.from(originalScript.attributes).forEach((attribute) => {
                script.setAttribute(attribute.name, attribute.value);
            });
            script.textContent = originalScript.textContent;

            target.appendChild(script);
            cleanupNodes.push(script);
            return;
        }

        const clonedNode = node.cloneNode(true);
        target.appendChild(clonedNode);
        cleanupNodes.push(clonedNode);
    });

    return cleanupNodes;
}

export default function InlineAdSlot({
    slotKey,
    script,
    className = '',
    label = 'Iklan',
    minHeightClassName = '',
    variant = 'page-inline',
    maxHeight = null,
    onHeightChange = null,
}) {
    const sectionRef = useRef(null);
    const containerRef = useRef(null);
    const mountedNodesRef = useRef([]);
    const resizeObserverRef = useRef(null);
    const signature = useMemo(() => `${slotKey}:${script || ''}`, [slotKey, script]);
    const [isSuppressed, setIsSuppressed] = useState(false);

    useEffect(() => {
        setIsSuppressed(false);
    }, [signature]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !script?.trim()) {
            return undefined;
        }

        mountedNodesRef.current = appendMarkup(container, script);

        return () => {
            mountedNodesRef.current.forEach((node) => {
                if (node?.parentNode === container) {
                    container.removeChild(node);
                }
            });
            mountedNodesRef.current = [];
            container.innerHTML = '';
        };
    }, [signature, script]);

    useEffect(() => {
        const section = sectionRef.current;
        const container = containerRef.current;
        if (!section || !container || typeof window === 'undefined' || typeof ResizeObserver === 'undefined') {
            return undefined;
        }

        const measure = () => {
            if (!sectionRef.current || !containerRef.current) {
                return;
            }

            const measuredHeight = sectionRef.current.offsetHeight || 0;
            const contentHeight = containerRef.current.scrollHeight || 0;
            const popupMaxHeight = Number(maxHeight) || 0;
            const shouldSuppress =
                variant === 'popup-inline' &&
                popupMaxHeight > 0 &&
                contentHeight > popupMaxHeight + 8;

            setIsSuppressed((previous) => {
                if (previous !== shouldSuppress) {
                    return shouldSuppress;
                }

                return previous;
            });

            if (typeof onHeightChange === 'function') {
                onHeightChange(shouldSuppress ? 0 : measuredHeight);
            }
        };

        resizeObserverRef.current = new ResizeObserver(() => {
            measure();
        });
        resizeObserverRef.current.observe(section);
        resizeObserverRef.current.observe(container);
        measure();

        return () => {
            resizeObserverRef.current?.disconnect();
            resizeObserverRef.current = null;
        };
    }, [maxHeight, onHeightChange, signature, script, variant]);

    useEffect(() => {
        return () => {
            if (typeof onHeightChange === 'function') {
                onHeightChange(0);
            }
        };
    }, [onHeightChange]);

    if (!script?.trim() || isSuppressed) {
        return null;
    }

    const isPopupVariant = variant === 'popup-inline';
    const sectionClassName = isPopupVariant
        ? `w-full ${className}`
        : `mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 ${className}`;
    const containerClassName = isPopupVariant
        ? `w-full overflow-hidden rounded-xl border border-gray-200/70 bg-white/70 px-3 py-3 shadow-sm dark:border-gray-700/70 dark:bg-gray-900/60 [&_*]:max-w-full [&_iframe]:mx-auto [&_iframe]:block [&_img]:h-auto ${minHeightClassName}`
        : `overflow-hidden rounded-2xl border border-gray-200/70 bg-white/70 p-3 shadow-sm dark:border-gray-700/70 dark:bg-gray-900/60 ${minHeightClassName}`;
    const containerStyle = isPopupVariant && maxHeight
        ? { maxHeight: `${maxHeight}px` }
        : undefined;

    return (
        <section
            ref={sectionRef}
            data-testid={`ad-slot-${slotKey}`}
            data-ad-slot={slotKey}
            className={sectionClassName}
        >
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                {label}
            </div>
            <div
                ref={containerRef}
                className={containerClassName}
                style={containerStyle}
            />
        </section>
    );
}
