/**
 * Procedural Moon Texture Generator
 *
 * Renders a realistic full moon on a canvas element:
 *   - Spherical shading (lit from upper-left)
 *   - Procedural surface texture (simplex-like noise for maria/highlands)
 *   - Craters with shadow rims and bright ejecta
 *   - Outer luminous halo
 *
 * Returns a canvas element that can be placed directly in the DOM.
 * The moon is rendered once and cached.
 */

// ─── Simple hash-based noise ────────────────────────

function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7fffffff) / 0x7fffffff;
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  // Smoothstep interpolation
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const n00 = hash(ix, iy);
  const n10 = hash(ix + 1, iy);
  const n01 = hash(ix, iy + 1);
  const n11 = hash(ix + 1, iy + 1);

  const nx0 = n00 + sx * (n10 - n00);
  const nx1 = n01 + sx * (n11 - n01);

  return nx0 + sy * (nx1 - nx0);
}

function fractalNoise(x: number, y: number, octaves: number): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / maxValue;
}

// ─── Crater data (manually placed for realism) ─────

interface Crater {
  x: number;  // 0-1 relative
  y: number;
  r: number;  // radius relative to moon radius
  depth: number; // darkness intensity
}

const CRATERS: Crater[] = [
  // Large maria (dark patches)
  { x: 0.35, y: 0.30, r: 0.18, depth: 0.25 },
  { x: 0.48, y: 0.45, r: 0.14, depth: 0.20 },
  { x: 0.30, y: 0.55, r: 0.12, depth: 0.22 },
  { x: 0.55, y: 0.28, r: 0.10, depth: 0.18 },
  { x: 0.42, y: 0.65, r: 0.09, depth: 0.15 },

  // Medium craters
  { x: 0.65, y: 0.40, r: 0.06, depth: 0.12 },
  { x: 0.25, y: 0.72, r: 0.05, depth: 0.14 },
  { x: 0.58, y: 0.60, r: 0.05, depth: 0.10 },
  { x: 0.72, y: 0.55, r: 0.04, depth: 0.12 },
  { x: 0.38, y: 0.18, r: 0.05, depth: 0.10 },
  { x: 0.20, y: 0.40, r: 0.04, depth: 0.13 },

  // Small craters
  { x: 0.75, y: 0.30, r: 0.025, depth: 0.10 },
  { x: 0.60, y: 0.75, r: 0.03, depth: 0.08 },
  { x: 0.28, y: 0.85, r: 0.025, depth: 0.09 },
  { x: 0.80, y: 0.65, r: 0.02, depth: 0.08 },
  { x: 0.15, y: 0.55, r: 0.02, depth: 0.10 },
  { x: 0.50, y: 0.82, r: 0.03, depth: 0.07 },
  { x: 0.68, y: 0.20, r: 0.025, depth: 0.09 },

  // Bright ray crater (Tycho-like, bottom)
  { x: 0.48, y: 0.85, r: 0.035, depth: -0.15 },
  // Bright ray crater (Copernicus-like)
  { x: 0.32, y: 0.42, r: 0.03, depth: -0.10 },
];

// ─── Main renderer ─────────────────────────────────

export function renderMoon(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.42; // Leave room for halo

  // Clear with transparency
  ctx.clearRect(0, 0, size, size);

  // Light direction (upper-left)
  const lightX = -0.4;
  const lightY = -0.5;
  const lightZ = 0.76;

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = (px - cx) / radius;
      const dy = (py - cy) / radius;
      const dist2 = dx * dx + dy * dy;

      if (dist2 > 1) continue; // Outside sphere

      // Surface normal on sphere
      const dz = Math.sqrt(1 - dist2);
      const nx = dx;
      const ny = dy;
      const nz = dz;

      // Diffuse lighting
      let lighting = nx * lightX + ny * lightY + nz * lightZ;
      lighting = Math.max(0.05, lighting); // Ambient minimum

      // Surface texture (fractal noise for highlands/maria)
      const noiseX = (px / size) * 8;
      const noiseY = (py / size) * 8;
      const surfaceNoise = fractalNoise(noiseX, noiseY, 6);

      // Base color: greyish-white moon surface
      let baseR = 200 + surfaceNoise * 40;
      let baseG = 195 + surfaceNoise * 38;
      let baseB = 185 + surfaceNoise * 35;

      // Apply craters
      const relX = px / size;
      const relY = py / size;

      for (const crater of CRATERS) {
        const cdx = relX - crater.x;
        const cdy = relY - crater.y;
        const cdist = Math.sqrt(cdx * cdx + cdy * cdy);

        if (cdist < crater.r) {
          // Inside crater
          const craterFade = cdist / crater.r;
          const intensity = (1 - craterFade * craterFade);

          if (crater.depth > 0) {
            // Dark crater/mare
            const darkening = crater.depth * intensity * 180;
            baseR -= darkening;
            baseG -= darkening;
            baseB -= darkening * 0.9;
          } else {
            // Bright ejecta
            const brightening = Math.abs(crater.depth) * intensity * 120;
            baseR += brightening;
            baseG += brightening;
            baseB += brightening;
          }
        } else if (cdist < crater.r * 1.3 && crater.depth > 0) {
          // Crater rim (slightly brighter)
          const rimFade = (cdist - crater.r) / (crater.r * 0.3);
          const rimBright = (1 - rimFade) * crater.depth * 60;
          baseR += rimBright;
          baseG += rimBright;
          baseB += rimBright;
        }
      }

      // Fine detail noise (small-scale surface roughness)
      const fineNoise = fractalNoise(noiseX * 4, noiseY * 4, 3);
      baseR += (fineNoise - 0.5) * 20;
      baseG += (fineNoise - 0.5) * 18;
      baseB += (fineNoise - 0.5) * 16;

      // Apply lighting
      let r = baseR * lighting;
      let g = baseG * lighting;
      let b = baseB * lighting;

      // Slight warm tint on lit areas
      if (lighting > 0.5) {
        const warmth = (lighting - 0.5) * 0.08;
        r += warmth * 30;
        g += warmth * 15;
      }

      // Limb darkening (natural phenomenon)
      const limb = 1 - Math.pow(dist2, 0.3) * 0.25;
      r *= limb;
      g *= limb;
      b *= limb;

      // Edge softness (anti-aliasing)
      const dist = Math.sqrt(dist2);
      let alpha = 255;
      if (dist > 0.97) {
        alpha = Math.max(0, (1 - dist) / 0.03 * 255);
      }

      const idx = (py * size + px) * 4;
      data[idx] = Math.max(0, Math.min(255, r));
      data[idx + 1] = Math.max(0, Math.min(255, g));
      data[idx + 2] = Math.max(0, Math.min(255, b));
      data[idx + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // ─── Outer halo glow (drawn behind via compositing) ───
  // We draw halo on a separate pass using the existing content
  const haloCanvas = document.createElement('canvas');
  haloCanvas.width = size;
  haloCanvas.height = size;
  const haloCtx = haloCanvas.getContext('2d')!;

  // Multiple soft glow layers
  const glowLayers = [
    { radius: radius * 1.35, alpha: 0.08 },
    { radius: radius * 1.20, alpha: 0.12 },
    { radius: radius * 1.10, alpha: 0.18 },
    { radius: radius * 1.04, alpha: 0.25 },
  ];

  for (const layer of glowLayers) {
    const gradient = haloCtx.createRadialGradient(cx, cy, radius * 0.95, cx, cy, layer.radius);
    gradient.addColorStop(0, `rgba(245, 240, 230, ${layer.alpha})`);
    gradient.addColorStop(0.5, `rgba(245, 240, 230, ${layer.alpha * 0.4})`);
    gradient.addColorStop(1, 'rgba(245, 240, 230, 0)');
    haloCtx.fillStyle = gradient;
    haloCtx.fillRect(0, 0, size, size);
  }

  // Composite: halo behind moon
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = size;
  finalCanvas.height = size;
  const finalCtx = finalCanvas.getContext('2d')!;

  finalCtx.drawImage(haloCanvas, 0, 0);
  finalCtx.drawImage(canvas, 0, 0);

  return finalCanvas;
}
