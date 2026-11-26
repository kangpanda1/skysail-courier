// Deterministic randomness for the fjord: a seeded integer hash, smooth value noise built on it,
// and fractal brownian motion that sums the octaves. No Math.random anywhere, so the same seed
// always raises the same coastline, the same stands of trees and the same cloud field — which is
// what makes a screenshot reproducible from the game's own code.

/** xorshift-style integer hash of two 32-bit ints to a uniform float in [0,1). */
export function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Same for a third axis, for cloud volume and rain. */
export function hash3(ix, iy, iz, seed) {
  let h = (ix * 2246822519 + iy * 3266489917 + iz * 668265263 + seed * 374761393) | 0;
  h = (h ^ (h >>> 15)) | 0;
  h = Math.imul(h, 1103515245);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Bilinear value noise at (x, y), period-free, `scale` cycles per unit. */
export function noise2(x, y, seed, scale = 1) {
  const fx = x * scale, fy = y * scale;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = smoother(fx - ix), ty = smoother(fy - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

/** Summed octaves in [0,1]: `octaves` layers, each `gain` as loud and `lacunarity` as fine. */
export function fbm(x, y, seed, octaves = 5, gain = 0.5, lacunarity = 2.03, baseScale = 1 / 900) {
  let sum = 0, amplitude = 1, total = 0, scale = baseScale;
  for (let i = 0; i < octaves; i += 1) {
    sum += amplitude * noise2(x, y, seed + i * 7919, scale);
    total += amplitude;
    amplitude *= gain;
    scale *= lacunarity;
  }
  return sum / total;
}

/** Ridged multifractal: 1 - |2n-1|, which makes sharp fjord walls instead of rolling hills. */
export function ridge(x, y, seed, octaves = 4, baseScale = 1 / 1400) {
  let sum = 0, amplitude = 1, total = 0, scale = baseScale;
  for (let i = 0; i < octaves; i += 1) {
    const n = noise2(x, y, seed + i * 6151, scale);
    sum += amplitude * (1 - Math.abs(2 * n - 1));
    total += amplitude;
    amplitude *= 0.55;
    scale *= 2.11;
  }
  return sum / total;
}

/** A seeded sequence of uniform floats, for placing trees and rocks without Math.random. */
export function sequence(seed, count) {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    out[i * 3] = hash2(i * 3 + 1, seed & 0xffff, seed);
    out[i * 3 + 1] = hash2(i * 7 + 5, (seed >>> 8) & 0xffff, seed ^ 0x5bf03635);
    out[i * 3 + 2] = hash2(i * 11 + 9, (seed >>> 16) & 0xffff, seed ^ 0x1b873593);
  }
  return out;
}
