// Generates the PWA PNG icons (no image libraries needed): `npm run icons`
// Blue rounded square with a white water drop; maskable variant is full-bleed with a smaller drop.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BLUE = [0x0b, 0x63, 0xb6];
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const SS = 4; // 4×4 supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const p = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          if (p) { r += p[0]; g += p[1]; b += p[2]; a += 255; }
        }
      const n = SS * SS;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const cov = a / 255;
      raw[o] = cov ? r / cov : 0; raw[o + 1] = cov ? g / cov : 0; raw[o + 2] = cov ? b / cov : 0; raw[o + 3] = a / n;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const inRoundedRect = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
// Drop: circle at the bottom joined to a point at the top. `s` scales it around the centre.
const inDrop = (x, y, s) => {
  const u = 0.5 + (x - 0.5) / s, v = 0.5 + (y - 0.5) / s;
  const cx = 0.5, cy = 0.6, rad = 0.22, top = 0.16;
  if ((u - cx) ** 2 + (v - cy) ** 2 <= rad * rad) return true;
  if (v < top || v > cy) return false;
  const half = rad * ((v - top) / (cy - top)) ** 0.8;
  return Math.abs(u - cx) <= half;
};

const standard = (x, y) => (!inRoundedRect(x, y, 0.22) ? null : inDrop(x, y, 1) ? WHITE : BLUE);
const maskable = (x, y) => (inDrop(x, y, 0.72) ? WHITE : BLUE);

writeFileSync('public/icons/icon-192.png', png(192, standard));
writeFileSync('public/icons/icon-512.png', png(512, standard));
writeFileSync('public/icons/icon-maskable-512.png', png(512, maskable));
console.log('Wrote public/icons/icon-192.png, icon-512.png, icon-maskable-512.png');
