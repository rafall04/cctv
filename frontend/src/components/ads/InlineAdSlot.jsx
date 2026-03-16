import { useEffect, useMemo, useRef } from 'react';

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
}) {
    const containerRef = useRef(null);
    const mountedNodesRef = useRef([]);
    const signature = useMemo(() => `${slotKey}:${script || ''}`, [slotKey, script]);

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

    if (!script?.trim()) {
        return null;
    }

    return (
        <section
            data-testid={`ad-slot-${slotKey}`}
            data-ad-slot={slotKey}
            className={`mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 ${className}`}
        >
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                {label}
            </div>
            <div
                ref={containerRef}
                className={`overflow-hidden rounded-2xl border border-gray-200/70 bg-white/70 p-3 shadow-sm dark:border-gray-700/70 dark:bg-gray-900/60 ${minHeightClassName}`}
            />
        </section>
    );
}
