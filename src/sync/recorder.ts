/**
 * Builds the `SyncWriter` the database layer uses to gate local writes and
 * mirror them into the sync outbox. The recorder is installed once by the
 * engine and stays dormant until sync is configured, so local-only users never
 * accumulate outbox rows.
 */

import {
  normalizeAccount,
  normalizeBudget,
  normalizeCategory,
  normalizeCategoryGroup,
  normalizeCategoryRule,
  normalizePayee,
  normalizeRecurring,
  normalizeTransaction,
  setSyncWriter,
  writeSyncState,
  type EntityKind,
  type OutboxRecord,
  type SyncWriter,
} from '../db/database';
import type { Settings, Transaction } from '../domain/types';
import type { HlcClock } from './hlc';
import type { SyncConfig } from './types';

export interface RecorderHooks {
  /** A local change was queued for the relay. */
  onLocalWrite?: () => void;
  /** A local write was gated out because a newer version exists. */
  onWriteSkipped?: () => void;
}

export function configureRecorder(
  nextConfig: SyncConfig | null,
  nextClock: HlcClock | null,
  hooks: RecorderHooks = {},
): void {
  if (!nextConfig || !nextClock) {
    setSyncWriter(null);
    return;
  }

  const active = nextConfig;
  const activeClock = nextClock;
  // HLC the database layer just minted via `nextHlc()`; `toChange` reuses it so
  // the version and the outbox row always agree. Everything runs inside the
  // database layer's exclusive lock, so a single slot is safe here.
  let issued = '';

  const writer: SyncWriter = {
    nextHlc(): string {
      issued = activeClock.next();
      return issued;
    },
    toChange(kind, id, value): OutboxRecord {
      return {
        changeId: crypto.randomUUID(),
        entityType: kind,
        entityId: id,
        hlc: issued,
        deleted: value === null,
        payload: value === null ? null : entityPayload(kind, value),
      };
    },
    async commitLastHlc(hlc): Promise<void> {
      active.lastHlc = hlc;
      await writeSyncState('app', active);
    },
    onLocalWrite: hooks.onLocalWrite,
    onWriteSkipped: hooks.onWriteSkipped,
  };

  setSyncWriter(writer);
}

/**
 * The fields both halves of a transfer are expected to hold in common. Sign and
 * account direction are deliberately excluded: those are what distinguish the
 * two legs, and comparing them would make every pair look divergent.
 */
export interface SharedTransferFields {
  date: string;
  notes: string;
  tags: string[];
  cleared: boolean;
  magnitude: number;
}

export function sharedTransferFields(transaction: Transaction): SharedTransferFields {
  return {
    date: transaction.date,
    notes: transaction.notes,
    tags: transaction.tags,
    cleared: transaction.cleared,
    magnitude: Math.abs(transaction.amount),
  };
}

export function sameTransferFields(a: SharedTransferFields, b: SharedTransferFields): boolean {
  return (
    a.date === b.date &&
    a.notes === b.notes &&
    a.cleared === b.cleared &&
    a.magnitude === b.magnitude &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index])
  );
}

export function entityPayload(kind: EntityKind, value: unknown): unknown {
  if (kind === 'settings') {
    // Spread every field so new settings (privacy, locale, future toggles)
    // are carried without another protocol change.
    return { ...(value as Settings) };
  }

  switch (kind) {
    case 'account':
      return normalizeAccount(value as Parameters<typeof normalizeAccount>[0]);
    case 'category':
      return normalizeCategory(value as Parameters<typeof normalizeCategory>[0]);
    case 'categoryGroup':
      return normalizeCategoryGroup(value as Parameters<typeof normalizeCategoryGroup>[0]);
    case 'payee':
      return normalizePayee(value as Parameters<typeof normalizePayee>[0]);
    case 'transaction':
      return normalizeTransaction(value as Parameters<typeof normalizeTransaction>[0]);
    case 'budget':
      return normalizeBudget(value as Parameters<typeof normalizeBudget>[0]);
    case 'recurring':
      return normalizeRecurring(value as Parameters<typeof normalizeRecurring>[0]);
    case 'rule':
      return normalizeCategoryRule(value as Parameters<typeof normalizeCategoryRule>[0]);
  }
}
