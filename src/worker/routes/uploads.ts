import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireRole } from '../middleware/auth';
import { COMMITTEE_VIEW, GUARD_APP } from '../../shared/roles';
import { currentUser, fail } from '../lib/http';
import { MAX_UPLOAD_BYTES, ALLOWED_IMAGE_TYPES, readBodyWithLimit, sniffImageType, verifyUpload } from '../lib/uploads';

const uploads = new Hono<AppEnv>();

/**
 * PUT /api/uploads/<key>?ct&size&exp&sig — body is the raw image.
 * The signature binds key, content type, exact size, expiry and the user who asked for it.
 */
uploads.put('/:key{checkins/.+}', requireRole(...GUARD_APP), async (c) => {
  const user = currentUser(c);
  const key = c.req.param('key');
  const ct = c.req.query('ct') ?? '';
  const size = Number(c.req.query('size'));
  const exp = Number(c.req.query('exp'));
  const sig = c.req.query('sig') ?? '';
  if (!(await verifyUpload(c.env, key, ct, size, exp, sig, user.id))) fail(403, 'Upload link is invalid or has expired. Please try again.');
  if (!ALLOWED_IMAGE_TYPES[ct]) fail(415, 'Only JPEG, PNG or WebP images are allowed.');
  if ((c.req.header('Content-Type') ?? '').split(';')[0] !== ct) fail(415, 'Content type does not match the upload link.');
  const declared = Number(c.req.header('Content-Length') ?? NaN);
  if (declared > MAX_UPLOAD_BYTES) fail(413, 'Photo is larger than 5 MB.');

  const bytes = await readBodyWithLimit(c.req.raw.body, MAX_UPLOAD_BYTES);
  if (!bytes) fail(413, 'Photo is larger than 5 MB.');
  if (bytes.byteLength !== size) fail(400, 'Uploaded size does not match the upload link.');
  if (sniffImageType(bytes) !== ct) fail(415, 'File is not a valid image.');

  await c.env.PHOTOS.put(key, bytes, {
    httpMetadata: { contentType: ct, cacheControl: 'private, max-age=86400' },
    customMetadata: { uploadedBy: String(user.id), uploadedAt: new Date().toISOString() },
  });
  return c.json({ ok: true, key }, 201);
});

/** Streams a stored photo to committee members and guards (never public). */
uploads.get('/:key{checkins/.+}', requireRole(...COMMITTEE_VIEW, 'guard'), async (c) => {
  const obj = await c.env.PHOTOS.get(c.req.param('key'));
  if (!obj) fail(404, 'Photo not found');
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
});

export default uploads;
