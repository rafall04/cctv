/*
 * Purpose: Single-field text prompt dialog — the Modal+Field replacement for window.prompt()
 *   (blocking, unstyled, unfocusable-managed, and dead inside in-app webviews). Used for the
 *   small "name this thing" interactions in the audio surface (save-as-template, clip category).
 * Caller: components/admin/audio/*.
 * Deps: components/ui (Modal, Field, Button, ModalFooter).
 * MainFuncs: TextPrompt.
 * SideEffects: calls onSubmit(value) when the operator confirms; Enter submits.
 */

import { useEffect, useState } from 'react';
import { Modal, ModalFooter, Field, Button } from '../../ui';

/**
 * @param {boolean} open
 * @param {string} title dialog title (accessible name)
 * @param {string} label field label
 * @param {string} [initial] starting value
 * @param {string} [placeholder]
 * @param {number} [maxLength]
 * @param {(value: string) => void} onSubmit trimmed value; empty string allowed (caller decides)
 * @param {() => void} onClose
 */
export default function TextPrompt({ open, title, label, initial = '', placeholder, maxLength, onSubmit, onClose }) {
    const [value, setValue] = useState(initial);
    // Resync when reopened for a different target (the mounted dialog is reused).
    useEffect(() => { if (open) setValue(initial); }, [open, initial]);
    if (!open) return null;

    const submit = (e) => {
        e?.preventDefault();
        onSubmit(value.trim());
    };

    return (
        <Modal title={title} onClose={onClose} size="sm">
            <form onSubmit={submit}>
                <Field
                    label={label}
                    autoFocus
                    value={value}
                    maxLength={maxLength}
                    placeholder={placeholder}
                    onChange={(e) => setValue(e.target.value)}
                />
                <ModalFooter className="mt-4">
                    <Button type="button" variant="ghost" onClick={onClose}>Batal</Button>
                    <Button type="submit" variant="primary">Simpan</Button>
                </ModalFooter>
            </form>
        </Modal>
    );
}
