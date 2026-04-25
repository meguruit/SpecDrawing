// Generates placeholder images for the MVP seed scene + catalog thumbnails.
// Run with: npm run seed:assets
// These are *placeholders*. A real scene would use photographic base + hand-painted masks.

import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUB = resolve(ROOT, "public");

const SCENE_W = 1024;
const SCENE_H = 768;
const HORIZON_Y = 380; // wall above, floor below

async function ensureDir(file) {
  await mkdir(dirname(file), { recursive: true });
}

async function writePng(path, png) {
  await ensureDir(path);
  await sharp(png, { raw: { width: SCENE_W, height: SCENE_H, channels: 4 } })
    .png()
    .toFile(path);
}

async function writeJpg(path, png) {
  await ensureDir(path);
  await sharp(png, { raw: { width: SCENE_W, height: SCENE_H, channels: 4 } })
    .jpeg({ quality: 88 })
    .toFile(path);
}

// Build a raw RGBA Buffer for the full scene from a per-pixel function.
function rasterize(fn) {
  const buf = Buffer.alloc(SCENE_W * SCENE_H * 4);
  for (let y = 0; y < SCENE_H; y++) {
    for (let x = 0; x < SCENE_W; x++) {
      const [r, g, b, a] = fn(x, y);
      const i = (y * SCENE_W + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
  return buf;
}

// Window rectangle on the wall — used to make shading non-trivial.
const WINDOW = { x: 600, y: 80, w: 280, h: 200 };

function inWindow(x, y) {
  return (
    x >= WINDOW.x &&
    x < WINDOW.x + WINDOW.w &&
    y >= WINDOW.y &&
    y < WINDOW.y + WINDOW.h
  );
}

// Distance-from-window light falloff (0..1, brighter near window).
function lightFactor(x, y) {
  const cx = WINDOW.x + WINDOW.w / 2;
  const cy = WINDOW.y + WINDOW.h / 2;
  const d = Math.hypot(x - cx, y - cy);
  const max = Math.hypot(SCENE_W, SCENE_H);
  return Math.max(0, 1 - (d / max) * 1.5);
}

// 1) base.jpg — photographic-ish room: beige wall (with a "window" rectangle), wooden floor.
async function generateBase() {
  const buf = rasterize((x, y) => {
    if (inWindow(x, y)) {
      // bright sky through window
      const t = (y - WINDOW.y) / WINDOW.h;
      const r = Math.round(180 + (1 - t) * 50);
      const g = Math.round(200 + (1 - t) * 40);
      const b = Math.round(230 + (1 - t) * 25);
      return [r, g, b, 255];
    }
    if (y < HORIZON_Y) {
      // wall — beige, with subtle horizontal stripe noise
      const stripe = Math.sin(y * 0.04) * 6;
      const r = Math.round(225 + stripe);
      const g = Math.round(215 + stripe);
      const b = Math.round(195 + stripe);
      return [r, g, b, 255];
    }
    // floor — wooden brown with plank lines
    const plank = (Math.floor(x / 90) + Math.floor((y - HORIZON_Y) / 60)) % 2;
    const base = plank ? 130 : 110;
    const grain = Math.sin(x * 0.5 + y * 0.1) * 8;
    return [
      Math.round(base + grain + 20),
      Math.round(base + grain),
      Math.round(base + grain - 20),
      255,
    ];
  });
  await writeJpg(resolve(PUB, "assets/base/living-room-01/base.jpg"), buf);
  console.log("✓ base.jpg");
}

// 2) mask_wall.png — alpha 255 over the wall area (excluding window), 0 elsewhere.
async function generateWallMask() {
  const buf = rasterize((x, y) => {
    if (y < HORIZON_Y && !inWindow(x, y)) return [255, 255, 255, 255];
    return [0, 0, 0, 0];
  });
  await writePng(resolve(PUB, "assets/base/living-room-01/mask_wall.png"), buf);
  console.log("✓ mask_wall.png");
}

// 3) shading_wall.png — grayscale luminance of the wall (light near window, darker far away).
async function generateWallShading() {
  const buf = rasterize((x, y) => {
    if (y < HORIZON_Y && !inWindow(x, y)) {
      const f = 0.55 + lightFactor(x, y) * 0.55;
      const v = Math.max(0, Math.min(255, Math.round(255 * f)));
      return [v, v, v, 255];
    }
    return [128, 128, 128, 255]; // outside-mask area is irrelevant; stay neutral
  });
  await writePng(
    resolve(PUB, "assets/base/living-room-01/shading_wall.png"),
    buf,
  );
  console.log("✓ shading_wall.png");
}

// 4) mask_floor.png — alpha 255 over the floor area.
async function generateFloorMask() {
  const buf = rasterize((x, y) => {
    if (y >= HORIZON_Y) return [255, 255, 255, 255];
    return [0, 0, 0, 0];
  });
  await writePng(
    resolve(PUB, "assets/base/living-room-01/mask_floor.png"),
    buf,
  );
  console.log("✓ mask_floor.png");
}

// 5) shading_floor.png — slightly darker further from window (top of floor area is far).
async function generateFloorShading() {
  const buf = rasterize((x, y) => {
    if (y >= HORIZON_Y) {
      const depth = (y - HORIZON_Y) / (SCENE_H - HORIZON_Y); // 0 at near horizon, 1 at bottom (close to viewer)
      const lateral = Math.abs(x - SCENE_W / 2) / (SCENE_W / 2);
      const f = 0.55 + depth * 0.4 + (1 - lateral) * 0.05;
      const v = Math.max(0, Math.min(255, Math.round(255 * f)));
      return [v, v, v, 255];
    }
    return [128, 128, 128, 255];
  });
  await writePng(
    resolve(PUB, "assets/base/living-room-01/shading_floor.png"),
    buf,
  );
  console.log("✓ shading_floor.png");
}

// Material thumbnails — small colored tiles with a label.
async function generateMaterial(id, hex, label) {
  const W = 220;
  const H = 320;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Thumbnail (smaller)
  const thumbW = 200;
  const thumbH = 200;
  const thumb = Buffer.alloc(thumbW * thumbH * 4);
  for (let y = 0; y < thumbH; y++) {
    for (let x = 0; x < thumbW; x++) {
      const grain = Math.sin(x * 0.3) * Math.cos(y * 0.4) * 12;
      const i = (y * thumbW + x) * 4;
      thumb[i] = Math.max(0, Math.min(255, r + grain));
      thumb[i + 1] = Math.max(0, Math.min(255, g + grain));
      thumb[i + 2] = Math.max(0, Math.min(255, b + grain));
      thumb[i + 3] = 255;
    }
  }
  const thumbSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${thumbW}" height="${thumbH}">
    <text x="50%" y="92%" text-anchor="middle" font-family="Helvetica, sans-serif" font-size="20" fill="white" stroke="black" stroke-width="0.5">${label}</text>
  </svg>`;
  const thumbPath = resolve(PUB, `assets/materials/${id}/thumb.png`);
  await ensureDir(thumbPath);
  await sharp(thumb, { raw: { width: thumbW, height: thumbH, channels: 4 } })
    .composite([{ input: Buffer.from(thumbSvg) }])
    .png()
    .toFile(thumbPath);

  // Placement image (taller — represents an item like a door)
  const placement = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const grain = Math.sin(x * 0.2) * Math.cos(y * 0.3) * 10;
      const border = x < 4 || x >= W - 4 || y < 4 || y >= H - 4 ? -40 : 0;
      const i = (y * W + x) * 4;
      thumb;
      placement[i] = Math.max(0, Math.min(255, r + grain + border));
      placement[i + 1] = Math.max(0, Math.min(255, g + grain + border));
      placement[i + 2] = Math.max(0, Math.min(255, b + grain + border));
      placement[i + 3] = 255;
    }
  }
  const placementPath = resolve(PUB, `assets/materials/${id}/placement.png`);
  await ensureDir(placementPath);
  await sharp(placement, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(placementPath);
  console.log(`✓ material ${id}`);
}

async function main() {
  await generateBase();
  await generateWallMask();
  await generateWallShading();
  await generateFloorMask();
  await generateFloorShading();

  await generateMaterial("door-N-FG-mBN", "#3b2a1f", "N-FG mBN 750");
  await generateMaterial("door-N-FG-mCP", "#8b6f4e", "N-FG mCP 750");
  await generateMaterial("door-N-FG-p4A", "#d4c4a8", "N-FG p4A 900");
  await generateMaterial("door-K-PL-mBN", "#2b1f15", "K-PL mBN 750");
  await generateMaterial("door-K-PL-mCP", "#7a5b3a", "K-PL mCP 900");
  await generateMaterial("floor-WD-OAK-natural", "#c79a6b", "WD-OAK natural");
  console.log("done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
