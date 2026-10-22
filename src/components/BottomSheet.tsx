/**
 * Mobile bottom-sheet drawer with swipe-to-close.
 *
 * Everything interactive sits in the lower half of the viewport (thumb zone):
 * the grab handle, the primary action footer and the close affordance.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Optional accent colour for the title dot. */
  accent?: string;
}

export function BottomSheet({ open, title, onClose, children, footer, accent }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const dragState = useRef({ active: false, startY: 0, startTime: 0, lastY: 0 });

  const reset = useCallback(() => setDragY(0), []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = {
      active: true,
      startY: event.clientY,
      lastY: event.clientY,
      startTime: Date.now(),
    };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.active) return;
    const delta = event.clientY - dragState.current.startY;
    dragState.current.lastY = event.clientY;
    setDragY(Math.max(0, delta));
  };

  const onPointerUp = () => {
    if (!dragState.current.active) return;
    const height = sheetRef.current?.offsetHeight ?? 400;
    const elapsed = Math.max(1, Date.now() - dragState.current.startTime);
    const velocity = (dragState.current.lastY - dragState.current.startY) / elapsed;
    dragState.current.active = false;

    if (dragY > height * 0.28 || velocity > 0.7) {
      reset();
      onClose();
    } else {
      reset();
    }
  };

  if (!open) return null;

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        ref={sheetRef}
        className="sheet"
        style={{
          transform: `translateY(${dragY}px)`,
          transition: dragState.current.active ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div
          className="sheet-grab-zone"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="sheet-handle" aria-hidden="true" />
          <div className="sheet-header">
            <span className="sheet-title">
              {accent && <span className="dot" style={{ background: accent }} />}
              {title}
            </span>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close panel">
              ✕
            </button>
          </div>
        </div>

        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>
  );
}
