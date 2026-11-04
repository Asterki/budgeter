/**
 * Wire identity for the Budget sync relay.
 *
 * Tasker spaces and Budget spaces must never meet: both the key derivation and
 * the protocol headers are versioned so a mixed space is rejected instead of
 * silently merging incompatible records.
 */

export const SYNC_PROTOCOL_VERSION = 2;
export const SYNC_SCHEMA_VERSION = 6;

export const PROTOCOL_HEADER = 'x-budget-sync-protocol';
export const SCHEMA_HEADER = 'x-budget-sync-schema';

/** Entity types written by the old Tasker builds. They are never merged. */
export const LEGACY_ENTITY_TYPES = ['task', 'project', 'place'] as const;

/** Raised when a relay or space speaks a different protocol generation. */
export class IncompatibleSyncSpaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompatibleSyncSpaceError';
  }
}
