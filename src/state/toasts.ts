export type ToastTone = 'info' | 'success' | 'danger';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

type Listener = (toasts: Toast[]) => void;

const MAX_VISIBLE = 3;
const DEFAULT_MS = 3_600;
/** Actionable toasts (undo) stay longer: the user has to notice and reach them. */
const ACTION_MS = 6_000;

let items: Toast[] = [];
let seq = 0;
const listeners = new Set<Listener>();
const timers = new Map<number, number>();

function emit(): void {
  for (const listener of listeners) listener(items);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
  if (!items.some((toast) => toast.id === id)) return;
  items = items.filter((toast) => toast.id !== id);
  emit();
}

/**
 * Shows a transient message. This is the app's only feedback surface: errors,
 * confirmations and undo all arrive here instead of window.alert or inline
 * notice blocks.
 */
export function notify(message: string, tone: ToastTone = 'info', action?: ToastAction): void {
  if (items.length >= MAX_VISIBLE) dismissToast(items[0].id);
  const toast: Toast = { id: ++seq, message, tone, action };
  items = [...items, toast];
  timers.set(
    toast.id,
    window.setTimeout(() => dismissToast(toast.id), action ? ACTION_MS : DEFAULT_MS),
  );
  emit();
}
