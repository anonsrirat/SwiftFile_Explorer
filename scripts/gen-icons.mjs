// Generates the SwiftSFTP logo, Windows icon set and NSIS installer artwork.
// Pure Node (zlib only) so it works without any image tooling installed.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------- colours ---------- */
const BRAND_A = [79, 70, 229]; // indigo-600
const BRAND_B = [6, 182, 212]; // cyan-500
const BOLT = [49, 46, 129]; // indigo-900
const INK = [15, 23, 42];

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Signed distance to a rounded rectangle, normalised 0..1 coordinates. */
function roundRectDistance(px, py, x0, y0, x1, y1, radius) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - radius;
  const hy = (y1 - y0) / 2 - radius;
  const dx = Math.abs(px - cx) - hx;
  const dy = Math.abs(py - cy) - hy;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside - radius;
}

/** Anti-aliased coverage from a distance in normalised space. */
function coverage(distance, pixel) {
  return clamp01(0.5 - distance / pixel);
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const BOLT_POINTS = [
  [0.548, 0.438],
  [0.408, 0.652],
  [0.498, 0.652],
  [0.455, 0.792],
  [0.607, 0.572],
  [0.516, 0.572],
];

/** Render the logo onto an RGBA buffer of `size` px. */
function renderLogo(size) {
  const data = Buffer.alloc(size * size * 4);
  const px = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;

      // Squircle plate
      const plate = coverage(roundRectDistance(nx, ny, 0.045, 0.045, 0.955, 0.955, 0.215), px);
      if (plate <= 0) continue;

      let colour = mix(BRAND_A, BRAND_B, clamp01((nx * 0.55 + ny * 0.75) * 0.85));

      // Soft top highlight for depth
      const highlight = clamp01(1 - ny / 0.5) * 0.16;
      colour = mix(colour, [255, 255, 255], highlight);

      // Folder glyph
      const body = coverage(roundRectDistance(nx, ny, 0.165, 0.44, 0.835, 0.8, 0.055), px);
      const tab = coverage(roundRectDistance(nx, ny, 0.165, 0.315, 0.53, 0.485, 0.04), px);
      const folder = Math.max(body, tab);
      if (folder > 0) {
        colour = mix(colour, [255, 255, 255], folder * 0.96);
      }

      // Lightning bolt (2x2 subsamples for the polygon edge)
      let bolt = 0;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const sampleX = (x + (sx + 0.5) / 2) / size;
          const sampleY = (y + (sy + 0.5) / 2) / size;
          if (pointInPolygon(sampleX, sampleY, BOLT_POINTS)) bolt += 0.25;
        }
      }
      if (bolt > 0) colour = mix(colour, BOLT, bolt);

      const offset = (y * size + x) * 4;
      data[offset] = Math.round(colour[0]);
      data[offset + 1] = Math.round(colour[1]);
      data[offset + 2] = Math.round(colour[2]);
      data[offset + 3] = Math.round(plate * 255);
    }
  }
  return data;
}

/* ---------- PNG ---------- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngFor(size) {
  return encodePNG(size, size, renderLogo(size));
}

/* ---------- ICO ---------- */
function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;
  entries.forEach((entry, index) => {
    const base = index * 16;
    directory[base] = entry.size >= 256 ? 0 : entry.size;
    directory[base + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[base + 2] = 0;
    directory[base + 3] = 0;
    directory.writeUInt16LE(1, base + 4);
    directory.writeUInt16LE(32, base + 6);
    directory.writeUInt32LE(entry.png.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.png.length;
  });
  return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
}

/* ---------- BMP ---------- */
function encodeBMP(width, height, rgb) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y; // BMP rows are bottom-up
    for (let x = 0; x < width; x++) {
      const s = (srcRow * width + x) * 3;
      const d = y * rowSize + x * 3;
      pixelData[d] = rgb[s + 2];
      pixelData[d + 1] = rgb[s + 1];
      pixelData[d + 2] = rgb[s];
    }
  }
  const fileHeader = Buffer.alloc(14);
  fileHeader.write("BM", 0, "ascii");
  fileHeader.writeUInt32LE(14 + 40 + pixelData.length, 2);
  fileHeader.writeUInt32LE(14 + 40, 10);
  const info = Buffer.alloc(40);
  info.writeUInt32LE(40, 0);
  info.writeInt32LE(width, 4);
  info.writeInt32LE(height, 8);
  info.writeUInt16LE(1, 12);
  info.writeUInt16LE(24, 14);
  info.writeUInt32LE(pixelData.length, 20);
  return Buffer.concat([fileHeader, info, pixelData]);
}

function blitLogo(rgb, canvasWidth, canvasHeight, size, originX, originY, plateOnly) {
  const logo = renderLogo(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = originX + x;
      const cy = originY + y;
      if (cx < 0 || cy < 0 || cx >= canvasWidth || cy >= canvasHeight) continue;
      const s = (y * size + x) * 4;
      const a = (plateOnly ? logo[s + 3] : logo[s + 3]) / 255;
      if (a <= 0) continue;
      const d = (cy * canvasWidth + cx) * 3;
      for (let c = 0; c < 3; c++) {
        rgb[d + c] = Math.round(rgb[d + c] * (1 - a) + logo[s + c] * a);
      }
    }
  }
}

function headerBMP() {
  const width = 150;
  const height = 57;
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const t = clamp01(nx * 0.9);
      const colour = mix([248, 250, 252], [226, 232, 240], t);
      const d = (y * width + x) * 3;
      rgb[d] = colour[0];
      rgb[d + 1] = colour[1];
      rgb[d + 2] = colour[2];
    }
  }
  blitLogo(rgb, width, height, 40, 10, 8, true);
  // Accent bar under the wordmark area
  for (let x = 58; x < 132; x++) {
    for (let y = 40; y < 43; y++) {
      const d = (y * width + x) * 3;
      const t = (x - 58) / 74;
      const colour = mix(BRAND_A, BRAND_B, t);
      rgb[d] = colour[0];
      rgb[d + 1] = colour[1];
      rgb[d + 2] = colour[2];
    }
  }
  return encodeBMP(width, height, rgb);
}

function sidebarBMP() {
  const width = 164;
  const height = 314;
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = clamp01(y / height);
      let colour = mix([15, 23, 42], [30, 41, 82], t);
      // Diagonal glow in the upper right
      const glow = clamp01(1 - Math.hypot((x - width * 0.85) / width, (y - height * 0.12) / height) * 2.1);
      colour = mix(colour, [56, 189, 248], glow * 0.35);
      const d = (y * width + x) * 3;
      rgb[d] = colour[0];
      rgb[d + 1] = colour[1];
      rgb[d + 2] = colour[2];
    }
  }
  blitLogo(rgb, width, height, 84, 40, 42, true);

  // Decorative "file rows"
  for (let i = 0; i < 3; i++) {
    const y0 = 168 + i * 26;
    const w = i === 1 ? 78 : i === 2 ? 96 : 64;
    for (let y = y0; y < y0 + 8; y++) {
      for (let x = 34; x < 34 + w; x++) {
        const d = (y * width + x) * 3;
        const alpha = 0.16 + i * 0.05;
        rgb[d] = Math.round(rgb[d] * (1 - alpha) + 226 * alpha);
        rgb[d + 1] = Math.round(rgb[d + 1] * (1 - alpha) + 232 * alpha);
        rgb[d + 2] = Math.round(rgb[d + 2] * (1 - alpha) + 240 * alpha);
      }
    }
  }

  // Bottom brand bar
  for (let x = 0; x < width; x++) {
    for (let y = height - 6; y < height; y++) {
      const d = (y * width + x) * 3;
      const colour = mix(BRAND_A, BRAND_B, x / width);
      rgb[d] = colour[0];
      rgb[d + 1] = colour[1];
      rgb[d + 2] = colour[2];
    }
  }
  return encodeBMP(width, height, rgb);
}

/* ---------- write outputs ---------- */
const iconsDir = join(root, "src-tauri", "icons");
const installerDir = join(root, "installer");
mkdirSync(iconsDir, { recursive: true });
mkdirSync(installerDir, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
writeFileSync(join(iconsDir, "icon.png"), pngFor(512));
writeFileSync(join(iconsDir, "32x32.png"), pngFor(32));
writeFileSync(join(iconsDir, "128x128.png"), pngFor(128));
writeFileSync(join(iconsDir, "128x128@2x.png"), pngFor(256));
writeFileSync(join(iconsDir, "icon-512.png"), pngFor(512));
writeFileSync(join(iconsDir, "StoreLogo.png"), pngFor(50));
writeFileSync(
  join(iconsDir, "icon.ico"),
  encodeICO(sizes.map((size) => ({ size, png: pngFor(size) })))
);
writeFileSync(join(installerDir, "header.bmp"), headerBMP());
writeFileSync(join(installerDir, "sidebar.bmp"), sidebarBMP());

console.log("Generated icons:", sizes.join(", "), "+ 512");
console.log("Generated installer/header.bmp and installer/sidebar.bmp");
