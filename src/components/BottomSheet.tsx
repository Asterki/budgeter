/**
 * Mobile bottom sheet. Ported from the tasker app so both apps feel the same:
 * the panel slides up from the thumb zone, can be dragged down to dismiss, and
 * unmounts completely when closed (no exit animation to keep in sync).
 */

import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from 'react';
import { FiX } from 'react-icons/fi';

interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  accent?: string;
}

/** Dragged past this fraction of its own height and the sheet closes. */
const DISMISS_RATIO = 0.28;
/** …or flicked faster than this, in pixels per millisecond. */
const DISMISS_VELOCITY = 0.7;

export function BottomSheet({ open, title, onClose, children, footer, accent }: BottomSheetProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startY: number; startTime: number; height: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    const sheet = sheetRef.current;
    if (!sheet) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startY: event.clientY,
      startTime: performance.now(),
      height: sheet.getBoundingClientRect().height,
    };
    sheet.style.transition = 'none';
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet) return;
    const dy = Math.max(0, event.clientY - drag.startY);
    sheet.style.transform = `translateY(${dy}px)`;
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    dragRef.current = null;
    if (!drag || !sheet) return;
    const dy = Math.max(0, event.clientY - drag.startY);
    const velocity = dy / Math.max(1, performance.now() - drag.startTime);
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > drag.height * DISMISS_RATIO || velocity > DISMISS_VELOCITY) onClose();
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={accent ? { borderTop: `2px solid ${accent}` } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="sheet__grab"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="sheet__handle" aria-hidden="true" />
        </div>
        <header className="sheet__header">
          <span className="sheet__title" id={titleId}>
            {title}
          </span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <FiX aria-hidden="true" />
          </button>
        </header>
        <div className="sheet__body">{children}</div>
        {footer && <footer className="sheet__footer">{footer}</footer>}
      </div>
    </div>
  );
}
