/**
 * Client-side push notification setup.
 *
 * Responsibilities:
 *  1. register the service worker,
 *  2. ask for notification permission,
 *  3. subscribe through `PushManager` with the VAPID public key,
 *  4. persist the subscription in IndexedDB (local source of truth),
 *  5. publish a reminder snapshot to the serverless cron endpoint.
 *
 * The cron endpoint cannot read IndexedDB, so the client mirrors the pending
 * reminders to it. Everything still works offline; only delivery needs the net.
 */

import { db } from '../db/database';
import type { PushSubscriptionRecord, Settings, Task } from '../domain/types';
import { occurrenceTimestamp } from '../domain/date';

/** Injected at build time by vite.config.ts (`__VAPID_PUBLIC_KEY__`). */
export function vapidPublicKey(): string {
  const fromBuild = typeof __VAPID_PUBLIC_KEY__ !== 'undefined' ? __VAPID_PUBLIC_KEY__ : '';
  return fromBuild || import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
}

export function notificationsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export interface EnableResult {
  ok: boolean;
  message: string;
}

/**
 * Opt-in flow.
 *
 * Permission is the only hard requirement: reminders are always delivered while
 * the app is open. Background delivery additionally needs a service worker and a
 * push subscription, which need a VAPID key — so that part is best-effort.
 */
export async function enableNotifications(): Promise<EnableResult> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { ok: false, message: 'This browser cannot show notifications.' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, message: 'Notification permission was not granted.' };
  }

  const registration = await registerServiceWorker();
  const key = vapidPublicKey();

  if (registration && key && 'PushManager' in window) {
    try {
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        }));
      await saveSubscription(subscription);
      return { ok: true, message: 'Notifications enabled — reminders also arrive while Tasker is closed.' };
    } catch {
      return { ok: true, message: 'Notifications enabled. Reminders arrive while Tasker is open.' };
    }
  }

  return { ok: true, message: 'Notifications enabled. Reminders arrive while Tasker is open.' };
}

export async function disableNotifications(): Promise<void> {
  if (!notificationsSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await subscription.unsubscribe().catch(() => undefined);
    await db.subscriptions.remove(subscription.endpoint);
  }
}

async function saveSubscription(subscription: PushSubscription): Promise<PushSubscriptionRecord> {
  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  const record: PushSubscriptionRecord = {
    id: subscription.endpoint,
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.subscriptions.put(record);
  return record;
}

/** Reads the locally stored push subscription, if the user opted in. */
export async function currentSubscription(): Promise<PushSubscriptionRecord | null> {
  const all = await db.subscriptions.all();
  return all.length > 0 ? all[all.length - 1] : null;
}

export interface ReminderPayload {
  id: string;
  taskId: string;
  title: string;
  body: string;
  /** Absolute epoch ms at which the push should fire. */
  timestamp: number;
}

/** Builds the reminder list the cron job needs to know about. */
export function buildReminders(tasks: Task[], settings: Settings): ReminderPayload[] {
  const lead = settings.reminderLeadMinutes * 60_000;
  return tasks
    .filter((task) => !task.completed && task.date && !task.reminded)
    .map((task) => {
      const at = occurrenceTimestamp(task.date, task.allDay ? null : task.time, task.allDay);
      return at === null
        ? null
        : {
            id: task.id,
            taskId: task.id,
            title: task.title,
            body: task.place ? `${task.place} · Tasker` : 'Tasker reminder',
            timestamp: at - lead,
          };
    })
    .filter((reminder): reminder is ReminderPayload => reminder !== null && reminder.timestamp > Date.now() - 60_000)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Pushes the current subscription + upcoming reminders to the serverless
 * endpoint so the Vercel cron job can deliver them while the app is closed.
 */
export async function syncReminders(tasks: Task[], settings: Settings): Promise<boolean> {
  const subscription = await currentSubscription();
  if (!subscription || !settings.notificationsEnabled) return false;

  try {
    const response = await fetch('/api/check-reminders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subscription,
        reminders: buildReminders(tasks, settings),
        leadMinutes: settings.reminderLeadMinutes,
      }),
    });
    return response.ok;
  } catch {
    // Offline — the next successful sync will catch up.
    return false;
  }
}
