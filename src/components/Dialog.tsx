/**
 * Small reusable dialog primitives.
 *
 * Dialogs are dependency-free: the backdrop closes on click, Escape closes the
 * top-most dialog, and the body owns the form. `ConfirmDialog` is the single
 * place destructive actions get confirmed.
 */

import { useEffect, useId, type ReactNode } from 'react';
import { FiX } from 'react-icons/fi';

interface DialogProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Dialog({ title, description, onClose, children, footer }: DialogProps) {
  const titleId = useId();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal modal--dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <span className="modal__title" id={titleId}>
            {title}
          </span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <FiX aria-hidden="true" />
          </button>
        </header>
        <div className="modal__body dialog__body">
          {description && <p className="dialog__description">{description}</p>}
          {children}
        </div>
        {footer && <footer className="dialog__footer">{footer}</footer>}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="dialog__description">{message}</p>
    </Dialog>
  );
}

interface ColorPickerProps {
  colors: string[];
  value: string;
  onChange: (color: string) => void;
  label?: string;
}

export function ColorPicker({ colors, value, onChange, label = 'Colour' }: ColorPickerProps) {
  return (
    <fieldset className="color-picker">
      <legend className="field__label">{label}</legend>
      <div className="color-picker__grid">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            className="color-picker__swatch"
            style={{ background: color }}
            aria-label={`Use colour ${color}`}
            aria-pressed={value === color}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </fieldset>
  );
}
