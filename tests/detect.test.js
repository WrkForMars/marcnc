import { describe, expect, it } from 'vitest';
import { adaptive, clean, detectInk, luminance, maskToRGBA, otsu } from '../src/input/detect.js';
import { tracedRings } from '../src/input/image.js';

const W = 300, H = 180;
/** Imagen RGBA a partir de una función (x, y) → [r, g, b]. */
const image = f => {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = f(x, y), i = 4 * (y * W + x); d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  return d;
};
const gray = v => [v, v, v];
const ring = (x, y) => Math.abs(Math.hypot(x - 150, y - 90) - 60) < 3;
const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(5);
/** Compara la máscara con la verdad: fondo tomado como dibujo y dibujo perdido, como fracción. */
const score = (m, truth) => {
  let fp = 0, fn = 0, t = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = m[y * W + x], b = truth(x, y); if (b) t++; if (a && !b) fp++; if (!a && b) fn++; }
  return { fp: fp / (W * H), fn: fn / t };
};

describe('otsu', () => {
  it('separa dos grupos de brillo', () => {
    const v = Uint8Array.from([...Array(500).fill(40), ...Array(500).fill(210)]);
    const t = otsu(v);
    expect(t).toBeGreaterThan(40); expect(t).toBeLessThanOrEqual(210);
  });
});

describe('detectInk', () => {
  // dibujo a plumón (70) en papel con una sombra que oscurece la derecha hasta 110, más ruido de cámara
  const photo = image((x, y) => gray((ring(x, y) ? 70 - 40 * x / W : 245 - 135 * x / W) + (rnd() - 0.5) * 40));

  it('foto de papel: la sombra no se toma como dibujo', () => {
    const { mask } = detectInk(photo, W, H, { mode: 'photo', clean: 1 });
    const s = score(mask, ring);
    expect(s.fp).toBeLessThan(0.005);
    expect(s.fn).toBeLessThan(0.1);
    // y al trazarla sale una sola figura (el anillo: contorno y hueco)
    expect(tracedRings(maskToRGBA(mask, W, H))).toHaveLength(2);
  });

  it('automático reconoce la foto con sombra y usa el modo foto', () => {
    const r = detectInk(photo, W, H, { mode: 'auto', clean: 1 });
    expect(r.used).toBe('photo');
    expect(score(r.mask, ring).fp).toBeLessThan(0.005);
  });

  it('automático conserva los rellenos grandes de un logo limpio', () => {
    const disk = (x, y) => Math.hypot(x - 150, y - 90) < 80;
    const r = detectInk(image((x, y) => gray(disk(x, y) ? 20 : 240)), W, H, { mode: 'auto' });
    expect(r.used).toBe('auto');
    expect(score(r.mask, disk)).toEqual({ fp: 0, fn: 0 });
  });

  it('con un umbral fijo la misma foto se rompe (por eso existe el modo foto)', () => {
    const { mask } = detectInk(photo, W, H, { mode: 'manual', thr: 128 });
    expect(score(mask, ring).fp).toBeGreaterThan(0.05);
  });

  it('automático: encuentra el umbral solo y voltea un fondo oscuro', () => {
    const light = detectInk(image((x, y) => gray(ring(x, y) ? 30 : 230)), W, H, { mode: 'auto' });
    expect(score(light.mask, ring)).toEqual({ fp: 0, fn: 0 });
    const dark = detectInk(image((x, y) => gray(ring(x, y) ? 230 : 20)), W, H, { mode: 'auto' });
    expect(dark.inverted).toBe(true);
    expect(score(dark.mask, ring)).toEqual({ fp: 0, fn: 0 });
  });

  it('automático: una imagen lisa no tiene dibujo', () => {
    expect(detectInk(image(() => gray(200 + (rnd() > 0.5 ? 5 : 0))), W, H, { mode: 'auto' }).ink).toBe(0);
  });

  it('por color: un logo blanco sobre fondo azul toma las letras, no el fondo', () => {
    const logo = image((x, y) => (ring(x, y) ? [250, 250, 250] : [36, 87, 197]));
    const { mask } = detectInk(logo, W, H, { mode: 'color' });
    expect(score(mask, ring)).toEqual({ fp: 0, fn: 0 });
    // amarillo sobre blanco: por brillo casi no se distingue, por color sí
    const yellow = image((x, y) => (ring(x, y) ? [240, 220, 40] : [255, 255, 255]));
    expect(score(detectInk(yellow, W, H, { mode: 'color' }).mask, ring).fn).toBe(0);
  });

  it('invertir voltea la detección', () => {
    const a = detectInk(image((x, y) => gray(ring(x, y) ? 30 : 230)), W, H, { mode: 'manual', thr: 128, invert: true });
    expect(a.mask[0]).toBe(1);
    expect(a.inverted).toBe(true);
  });
});

describe('clean', () => {
  it('quita puntos sueltos y tapa huecos chicos sin mover lo grande', () => {
    const m = new Uint8Array(W * H);
    for (let y = 40; y < 140; y++) for (let x = 40; x < 260; x++) m[y * W + x] = 1; // bloque
    m[90 * W + 150] = 0; m[90 * W + 151] = 0; // hueco de 2 px
    m[10 * W + 10] = 1; m[10 * W + 11] = 1; // mancha de 2 px
    const c = clean(m, W, H, 1);
    expect(c[10 * W + 10]).toBe(0);
    expect(c[90 * W + 150]).toBe(1);
    expect(c[40 * W + 40]).toBe(1); expect(c[139 * W + 259]).toBe(1); // esquinas intactas
    expect(c[39 * W + 40]).toBe(0);
  });
});

describe('adaptive y luminance', () => {
  it('un papel liso con degradado no tiene dibujo', () => {
    const g = luminance(image(x => gray(250 - 120 * x / W)), W * H);
    expect(adaptive(g, W, H).reduce((a, v) => a + v, 0)).toBe(0);
  });
});
