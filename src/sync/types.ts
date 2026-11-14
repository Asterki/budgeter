/** Shared shapes for the optional sync layer. */

import type { EntityKind } from '../db/database';

export type { EntityKind };

export interface SyncConfig {
  key: 'app';
  serverUrl: string;
  clientId: string;
  authKey: string;
  encKey: CryptoKey;
  fingerprint: string;
  cursor: number;
  enabled: boolean;
  lastSyncAt: number;
  lastHlc: string;
}

export type SyncState = 'off' | 'idle' | 'syncing' | 'error' | 'degraded' | 'offline';

export interface SyncStatus {
  configured: boolean;
  state: SyncState;
  pending: number;
  lastSyncAt: number;
  error: string | null;
  /** Changes the relay refused outright; kept locally, never silently dropped. */
  quarantined: number;
  /** Rows a pull could not apply because a local version was newer. */
  skipped: number;
  fingerprint: string;
}

export interface SyncInfo {
  serverUrl: string;
  fingerprint: string;
  lastSyncAt: number;
}

export interface RemoteChange {
  seq: number;
  changeId: string;
  clientId: string;
  entityType: EntityKind;
  entityId: string;
  hlc: string;
  deleted: boolean;
  payload: string;
}

export interface RemoteEntity {
  entityType: EntityKind;
  entityId: string;
  hlc: string;
  deleted: boolean;
  payload: string;
}

export interface ChangesPage {
  changes: RemoteChange[];
  cursor: number;
  hasMore: boolean;
}

export interface SnapshotPage {
  entities: RemoteEntity[];
  next: { type: string; id: string } | null;
  head: number;
}

/** The relay's verdict for one pushed change. */
export interface PushVerdict {
  changeId: string;
  applied: boolean;
  error?: string;
}

export interface PushResponse {
  accepted: string[];
  duplicates: number;
  cursor: number;
  /**
   * Present only when the request opted in with `x-budget-sync-acks: 1`.
   * One entry per requested change, in request order. When it is absent the
   * relay is an older build and a 200 means "the whole batch landed".
   */
  changes?: PushVerdict[];
}

/** A change the relay refuses to accept, kept out of the way of the queue. */
export interface QuarantinedChange {
  changeId: string;
  reason: string;
}

/** Thrown before a connection when the passphrase has no remote data yet. */
export class NewSyncSpaceError extends Error {
  constructor() {
    super('This passphrase has no sync data yet.');
    this.name = 'NewSyncSpaceError';
  }
}
