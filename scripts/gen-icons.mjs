// Generates Revela app icons (PNG + ICO) without any dependencies.
// Usage: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

// ---------- PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Icon drawing ----------
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const s = size;
  const cx = s / 2;
  const cy = s / 2;
  const corner = s * 0.22;
  const R = s * 0.335; // aperture ring radius
  const ringW = s * 0.085;
  const aa = Math.max(1, s / 128);

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const fx = x + 0.5;
      const fy = y + 0.5;

      // rounded-square background SDF
      const qx = Math.abs(fx - cx) - (s / 2 - corner - s * 0.02);
      const qy = Math.abs(fy - cy) - (s / 2 - corner - s * 0.02);
      const dOut = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - corner;
      const bgA = 1 - smooth(-aa, aa, dOut);
      if (bgA <= 0) continue;

      // background vertical gradient
      const g = y / s;
      let r = 0x20 + (0x14 - 0x20) * g;
      let gg = 0x22 + (0x15 - 0x22) * g;
      let b = 0x28 + (0x19 - 0x28) * g;

      const dx = fx - cx;
      const dy = fy - cy;
      const dist = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);

      // aperture ring with 6 blade gaps
      const ringD = Math.abs(dist - R) - ringW;
      let ringA = 1 - smooth(-aa, aa, ringD);
      const sector = ((ang + Math.PI) / (Math.PI / 3)) % 1; // 6 sectors
      const gap = smooth(0.045, 0.085, Math.min(sector, 1 - sector)); // 1 outside gap
      ringA *= gap;

      // warm gradient along the angle (film / darkroom amber)
      const t = (Math.sin(ang - 0.7) + 1) / 2;
      const rr = 0xf2 + (0xe0 - 0xf2) * t;
      const rg = 0x9a + (0x5c - 0x9a) * t;
      const rb = 0x3a + (0x33 - 0x3a) * t;

      // center dot
      const dotA = 1 - smooth(s * 0.10 - aa, s * 0.10 + aa, dist);

      r = r * (1 - ringA) + rr * ringA;
      gg = gg * (1 - ringA) + rg * ringA;
      b = b * (1 - ringA) + rb * ringA;
      r = r * (1 - dotA) + 0xf5 * dotA;
      gg = gg * (1 - dotA) + 0xef * dotA;
      b = b * (1 - dotA) + 0xdd * dotA;

      px[i] = Math.round(r);
      px[i + 1] = Math.round(gg);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(bgA * 255);
    }
  }
  return px;
}

// ---------- ICO encoder (BMP entries for small sizes, PNG for 256) ----------
function bmpEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND mask height
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(size * size * 4, 20);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4; // bottom-up
      const dst = (y * size + x) * 4;
      xor[dst] = rgba[src + 2]; // B
      xor[dst + 1] = rgba[src + 1]; // G
      xor[dst + 2] = rgba[src]; // R
      xor[dst + 3] = rgba[src + 3]; // A
    }
  }
  const andMask = Buffer.alloc(Math.ceil(size / 32) * 4 * size); // all opaque
  return Buffer.concat([header, xor, andMask]);
}

function encodeIco(entries) {
  // entries: [{ size, data (raw entry bytes), isPng }]
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

// ---------- Generate ----------
const sizes = { "32x32.png": 32, "128x128.png": 128, "128x128@2x.png": 256, "icon.png": 512 };
for (const [name, size] of Object.entries(sizes)) {
  writeFileSync(join(outDir, name), encodePng(size, drawIcon(size)));
  console.log("wrote", name);
}

const ico = encodeIco([
  { size: 16, data: bmpEntry(16, drawIcon(16)) },
  { size: 32, data: bmpEntry(32, drawIcon(32)) },
  { size: 48, data: bmpEntry(48, drawIcon(48)) },
  { size: 256, data: encodePng(256, drawIcon(256)) },
]);
writeFileSync(join(outDir, "icon.ico"), ico);
console.log("wrote icon.ico");
