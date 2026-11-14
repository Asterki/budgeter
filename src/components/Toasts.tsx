import { useEffect, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { dismissToast, subscribeToasts, type Toast } from '../state/toasts';

export function Toasts(): JSX.Element | null {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <span className="toast__message">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                toast.action?.run();
                dismissToast(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            className="icon-button toast__close"
            aria-label="Dismiss"
            onClick={() => dismissToast(toast.id)}
          >
            <FiX aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
