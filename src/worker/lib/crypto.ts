// Password hashing and token helpers built only on the Web Crypto API
// (works in Cloudflare Workers, Node 20+ and browsers; no native modules).
// Keep this file free of imports so scripts can use it directly.

/** Cloudflare Workers caps PBKDF2 at 100,000 iterations, which is also our minimum. */
export const PBKDF2_ITERATIONS = 100_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

const enc = new TextEncoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Constant-time comparison of two equal-length byte arrays. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BYTES * 8);
  return new Uint8Array(bits);
}

export interface PasswordHash {
  /** Stored in users.password_hash, e.g. "pbkdf2-sha256$100000$<base64>" */
  hash: string;
  /** Stored in users.salt (base64 of 16 random bytes) */
  salt: string;
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<PasswordHash> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await pbkdf2(password, salt, iterations);
  return { hash: `pbkdf2-sha256$${iterations}$${toBase64(derived)}`, salt: toBase64(salt) };
}

export async function verifyPassword(password: string, stored: string, saltB64: string): Promise<boolean> {
  const [algo, iterStr, hashB64] = stored.split('$');
  const iterations = Number(iterStr);
  if (algo !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 1 || !hashB64) return false;
  let expected: Uint8Array;
  let salt: Uint8Array;
  try {
    expected = fromBase64(hashB64);
    salt = fromBase64(saltB64);
  } catch {
    return false;
  }
  const derived = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(derived, expected);
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(input))));
}

/** 32 random bytes, base64url — used for session tokens. */
export function generateToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message))));
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(enc.encode(a), enc.encode(b));
}
