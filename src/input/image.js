// Imagen → píxeles de dibujo (detect.js) → contornos con ImageTracer, o línea central de cada trazo.
import ImageTracer from 'imagetracerjs';
import { centerlines } from './centerline.js';
import { detectInk, maskToRGBA, clean } from './detect.js';
import { segmentObject } from './segment.js';

const TRACE_OPTS = {
  numberofcolors: 2, colorsampling: 0,
  pal: [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }],
  ltres: 0.8, qtres: 0.8, pathomit: 8, linefilter: true, blurradius: 0,
};

/**
 * Lee los datos del trazado directamente (sin generar SVG ni tocar el DOM).
 * @param {ImageData} imgd imagen ya binarizada (negro = dibujo)
 * @returns {[number,number][][]} anillos en píxeles (contornos y huecos mezclados; usar regla par-impar)
 */
export function tracedRings(imgd) {
  const td = ImageTracer.imagedataToTracedata(imgd, TRACE_OPTS);
  const li = td.palette.findIndex(p => p.r < 128);
  const rings = [];
  (td.layers[li] || []).forEach(p => {
    const pts = [];
    p.segments.forEach((s, k) => {
      if (k === 0) pts.push([s.x1, s.y1]);
      if (s.type === 'Q') {
        for (let j = 1; j <= 3; j++) {
          const t = j / 3, u = 1 - t;
          pts.push([u * u * s.x1 + 2 * u * t * s.x2 + t * t * s.x3, u * u * s.y1 + 2 * u * t * s.y2 + t * t * s.y3]);
        }
      } else {
        pts.push([s.x2, s.y2]);
      }
    });
    if (pts.length > 2) rings.push(pts);
  });
  return rings;
}

/** Pasa a blanco y negro en el lugar: más oscuro que `thr` (0–255) cuenta como dibujo (lo usan los textos rellenos). */
export function binarize(imgd, thr) {
  const a = imgd.data;
  for (let i = 0; i < a.length; i += 4) {
    const v = (0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]) < thr ? 0 : 255;
    a[i] = a[i + 1] = a[i + 2] = v;
    a[i + 3] = 255;
  }
  return imgd;
}

/**
 * @typedef {{
 *   mode: import('./detect.js').DetectMode, thr?: number, invert?: boolean, clean?: number,
 *   how?: 'area'|'center',             // áreas con contorno, o línea central de cada trazo
 *   detail?: number,                   // píxeles del lado mayor con los que se trabaja
 *   crop?: {x:number, y:number, w:number, h:number}|null,  // recorte, en fracciones de la imagen (0–1)
 *   seeds?: {x:number, y:number, fg:boolean}[],  // modo 'object': toques en fracciones de la imagen (0–1)
 * }} TraceOptions
 */

/**
 * @param {HTMLImageElement} img
 * @param {TraceOptions} o
 * @returns {import('./svg.js').RawShape[] & {regionMode:string, mask:{w:number, h:number, data:Uint8Array}, info:{inverted:boolean, ink:number, used:string}}}
 */
export function traceImage(img, o) {
  // 600 px en el lado mayor bastan para la ball mill y trazan en ~0.3 s; con una V-bit fina conviene más detalle
  const c0 = o.crop || { x: 0, y: 0, w: 1, h: 1 };
  const sx = c0.x * img.naturalWidth, sy = c0.y * img.naturalHeight, sw = c0.w * img.naturalWidth, sh = c0.h * img.naturalHeight;
  const k = Math.min(4, (o.detail || 600) / Math.max(sw, sh));
  const w = Math.max(8, Math.round(sw * k)), h = Math.max(8, Math.round(sh * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); // lo transparente cuenta como fondo
  x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const rgba = x.getImageData(0, 0, w, h).data;
  let det;
  if (o.mode === 'object') {
    // toques de la imagen completa → píxeles del recorte; los que caen fuera no cuentan
    const seeds = (o.seeds || []).map(s => ({ x: (s.x * img.naturalWidth - sx) * k, y: (s.y * img.naturalHeight - sy) * k, fg: s.fg }))
      .filter(s => s.x >= 0 && s.y >= 0 && s.x < w && s.y < h);
    if (!seeds.some(s => s.fg)) throw new Error('Toca el objeto en la imagen (dentro del recorte).');
    const mask = clean(segmentObject(rgba, w, h, { seeds }), w, h, o.clean || 0);
    det = { mask, inverted: false, ink: mask.reduce((a, v) => a + v, 0) / (w * h), used: 'object' };
  } else det = detectInk(rgba, w, h, o);
  if (!det.ink) throw new Error(o.mode === 'object' ? 'No pude separar el objeto: toca más partes de él.' : 'No encontré dibujo en la imagen. Prueba otro modo de detección o márcala como invertida.');
  let shapes;
  if (o.how === 'center') {
    const groups = centerlines(det.mask, w, h);
    if (!groups.length) throw new Error('No encontré trazos en la imagen. Prueba otro modo de detección.');
    shapes = groups.map(g => ({ kind: 'stroke', group: true, lines: g.lines }));
  } else {
    shapes = [{ kind: 'fill', white: false, rule: 'evenodd', rings: tracedRings(maskToRGBA(det.mask, w, h)) }];
  }
  return Object.assign(shapes, { regionMode: det.used === 'object' ? 'contour' : 'fill', mask: { w, h, data: det.mask }, info: { inverted: det.inverted, ink: det.ink, used: det.used } });
}
