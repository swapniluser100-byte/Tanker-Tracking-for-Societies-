import { api } from './api';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Shrinks a camera photo to at most 1600 px on the long side as JPEG (~200–500 KB).
 * Phone cameras produce 3–8 MB images; this keeps uploads fast on slow connections.
 * Falls back to the original file if the browser can't decode it.
 */
export async function compressPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (blob && blob.size < file.size) return blob;
  } catch {
    /* fall through to the original */
  }
  return file;
}

/** Signs an upload with the Worker, then PUTs the bytes through it into R2. Returns the R2 key. */
export async function uploadCheckinPhoto(file: File): Promise<string> {
  const blob = await compressPhoto(file);
  const type = blob.type || file.type;
  if (!ALLOWED.includes(type)) throw new Error('Please choose a JPEG, PNG or WebP photo.');
  if (blob.size > MAX_PHOTO_BYTES) throw new Error('Photo is larger than 5 MB. Please retake it.');
  const signed = await api<{ key: string; uploadUrl: string }>('/guard/uploads/sign', { body: { contentType: type, size: blob.size } });
  await api(signed.uploadUrl, { method: 'PUT', body: new Blob([blob], { type }), headers: { 'Content-Type': type } });
  return signed.key;
}
