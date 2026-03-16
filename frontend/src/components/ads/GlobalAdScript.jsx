import { useEffect, useMemo, useRef } from 'react';

function createScriptNode(markup, slotKey) {
    const trimmedMarkup = typeof markup === 'string' ? markup.trim() : '';
    if (!trimmedMarkup) {
        return [];
    }

    const nodes = [];

    if (trimmedMarkup.startsWith('<') && !trimmedMarkup.includes('<script')) {
        const template = document.createElement('template');
        template.innerHTML = trimmedMarkup;

        Array.from(template.content.childNodes).forEach((node) => {
            const clone = node.cloneNode(true);
            if (clone.nodeType === Node.ELEMENT_NODE) {
                clone.dataset.adSlot = slotKey;
            }
            nodes.push(clone);
        });

        return nodes;
    }

    if (!trimmedMarkup.includes('<script')) {
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.textContent = trimmedMarkup;
        script.dataset.adSlot = slotKey;
        nodes.push(script);
        return nodes;
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
            script.dataset.adSlot = slotKey;
            nodes.push(script);
            return;
        }

        const clone = node.cloneNode(true);
        if (clone.nodeType === Node.ELEMENT_NODE) {
            clone.dataset.adSlot = slotKey;
        }
        nodes.push(clone);
    });

    return nodes;
}

export default function GlobalAdScript({ slotKey, script }) {
    const mountedNodesRef = useRef([]);
    const signature = useMemo(() => `${slotKey}:${script || ''}`, [slotKey, script]);

    useEffect(() => {
        if (!script?.trim()) {
            return undefined;
        }

        const nodes = createScriptNode(script, slotKey);
        nodes.forEach((node) => {
            document.body.appendChild(node);
        });
        mountedNodesRef.current = nodes;

        return () => {
            mountedNodesRef.current.forEach((node) => {
                if (node?.parentNode) {
                    node.parentNode.removeChild(node);
                }
            });
            mountedNodesRef.current = [];
        };
    }, [signature, script, slotKey]);

    return null;
}
