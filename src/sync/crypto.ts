/**
 * Key derivation and payload encryption for sync.
 *
 * The passphrase is stretched in the browser; the relay only ever sees the
 * derived authentication key (as a SHA-256 hash) and AES-GCM ciphertext.
 */

const encoder = new TextEncoder();
const ITERATIONS = 600_000;

/**
 * Budget uses its own salt and HKDF labels. A passphrase reused from Tasker
 * therefore maps to a completely different space, never a shared one.
 */
const CONTEXTS = {
  budget: {
    salt: 'budget-sync-v1',
    authInfo: 'budget-auth',
    encInfo: 'budget-enc',
  },
  tasker: {
    salt: 'tasker-sync-v1',
    authInfo: 'tasker-auth',
    encInfo: 'tasker-enc',
  },
} as const;

export type SyncKeyContext = keyof typeof CONTEXTS;

export interface SyncKeys {
  authKey: string;
  encKey: CryptoKey;
  fingerprint: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function deriveKeys(
  passphrase: string,
  context: SyncKeyContext = 'budget',
): Promise<SyncKeys> {
  const normalized = passphrase.normalize('NFKC');
  const labels = CONTEXTS[context];
  const base = await crypto.subtle.importKey('raw', encoder.encode(normalized), 'PBKDF2', false, [
    'deriveBits',
  ]);

  const masterBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(labels.salt), iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    256,
  );

  const hkdf = await crypto.subtle.importKey('raw', masterBits, 'HKDF', false, ['deriveBits', 'deriveKey']);

  const authBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(labels.authInfo) },
    hkdf,
    256,
  );

  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(labels.encInfo) },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  const authKey = toBase64Url(new Uint8Array(authBits));
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(authKey)),
  );

  return {
    authKey,
    encKey,
    fingerprint: Array.from(digest.slice(0, 4), (byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
}

export async function encryptPayload(value: unknown, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`;
}

export async function decryptPayload<T>(value: string, key: CryptoKey): Promise<T> {
  const [ivPart, cipherPart] = value.split('.');
  if (!ivPart || !cipherPart) throw new Error('Malformed sync payload');

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(ivPart) },
    key,
    fromBase64Url(cipherPart),
  );

  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
