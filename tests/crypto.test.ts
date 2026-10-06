import { describe, expect, it } from 'vitest';
import { PBKDF2_ITERATIONS, fromBase64, generateToken, hashPassword, sha256Hex, verifyPassword } from '../src/worker/lib/crypto';

describe('password hashing (PBKDF2-SHA256 via Web Crypto)', () => {
  it('hashes with at least 100,000 iterations and a 16-byte random salt', async () => {
    const { hash, salt } = await hashPassword('correct horse battery');
    const [algo, iterations, digest] = hash.split('$');
    expect(algo).toBe('pbkdf2-sha256');
    expect(Number(iterations)).toBeGreaterThanOrEqual(100_000);
    expect(Number(iterations)).toBe(PBKDF2_ITERATIONS);
    expect(fromBase64(salt)).toHaveLength(16);
    expect(fromBase64(digest)).toHaveLength(32);
    expect(hash).not.toContain('correct horse');
  });

  it('verifies the right password', async () => {
    const { hash, salt } = await hashPassword('JalSetu@2026');
    expect(await verifyPassword('JalSetu@2026', hash, salt)).toBe(true);
  });

  it('rejects a wrong password, wrong salt, or tampered hash', async () => {
    const { hash, salt } = await hashPassword('JalSetu@2026');
    const other = await hashPassword('JalSetu@2026');
    expect(await verifyPassword('jalsetu@2026', hash, salt)).toBe(false);
    expect(await verifyPassword('JalSetu@2026', hash, other.salt)).toBe(false);
    expect(await verifyPassword('JalSetu@2026', hash.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')), salt)).toBe(false);
  });

  it('uses a different salt (and so a different hash) every time', async () => {
    const a = await hashPassword('same password here');
    const b = await hashPassword('same password here');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('fails closed on malformed stored values', async () => {
    expect(await verifyPassword('x', 'plaintext', 'c2FsdA==')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2-sha256$abc$AAAA', 'c2FsdA==')).toBe(false);
    expect(await verifyPassword('x', 'md5$1000$AAAA', 'c2FsdA==')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2-sha256$1000$***', 'c2FsdA==')).toBe(false);
  });
});

describe('tokens', () => {
  it('session tokens are 32 random bytes, base64url', () => {
    const t = generateToken(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken(32)).not.toBe(t);
  });

  it('sha256Hex is stable (only this is stored for sessions/API keys)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
