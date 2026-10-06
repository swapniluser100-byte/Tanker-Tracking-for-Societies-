import { generateToken, hmacSha256Hex, timingSafeEqualStr } from './crypto';
import type { Env } from '../env';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const URL_TTL_SECONDS = 10 * 60;

/**
 * HMAC key for upload URLs: the UPLOAD_SIGNING_SECRET secret if set, otherwise a random key
 * generated once and stored in D1 (never exported), so a fresh deploy works without extra setup.
 */
async function secret(env: Env): Promise<string> {
  if (env.UPLOAD_SIGNING_SECRET) return env.UPLOAD_SIGNING_SECRET;
  const read = () => env.DB.prepare("SELECT value FROM settings WHERE key = 'upload_signing_secret'").first<{ value: string }>();
  const row = await read();
  if (row) return row.value;
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('upload_signing_secret', ?)").bind(generateToken(32)).run();
  return (await read())!.value;
}

const payload = (key: string, contentType: string, size: number, exp: number, userId: number) => `${key}|${contentType}|${size}|${exp}|${userId}`;

/** Creates a short-lived signed URL that lets one user PUT one specific object through the Worker. */
export async function signUpload(env: Env, key: string, contentType: string, size: number, userId: number) {
  const exp = Math.floor(Date.now() / 1000) + URL_TTL_SECONDS;
  const sig = await hmacSha256Hex(await secret(env), payload(key, contentType, size, exp, userId));
  const qs = new URLSearchParams({ ct: contentType, size: String(size), exp: String(exp), sig });
  return { key, uploadUrl: `/api/uploads/${key}?${qs}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export async function verifyUpload(env: Env, key: string, contentType: string, size: number, exp: number, sig: string, userId: number) {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = await hmacSha256Hex(await secret(env), payload(key, contentType, size, exp, userId));
  return timingSafeEqualStr(expected, sig);
}

/** Checks the file's magic bytes so a renamed non-image can't be stored as an image. */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

/** Reads a request body, aborting once it exceeds `limit` bytes. */
export async function readBodyWithLimit(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const ch of chunks) {
    out.set(ch, offset);
    offset += ch.byteLength;
  }
  return out;
}
